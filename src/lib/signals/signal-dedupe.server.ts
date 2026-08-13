// Persistent deduplication + history for the Signal Engine.
//
// Table: public.signal_log (see docs/SQL_SIGNALS.md). The unique index on
// `fingerprint` is the hard anti-spam guarantee: the same (type, token, event)
// can only ever be reserved once. Everything else (cooldowns, retry limits,
// last-notified values) is derived from the same table, so there is no second
// source of truth to drift.
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type { SignalCandidate, SignalLogRow, SignalStatus, SignalType } from "./signal-types";

export const SIGNAL_TABLE = "signal_log";
const MAX_ATTEMPTS = 3;

export class SignalStorageError extends Error {}

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function missingTable(message: string): boolean {
  return /relation .*signal_log.* does not exist|could not find the table|schema cache/i.test(message);
}

/** Deterministic fingerprint: hash(type + token + eventId). */
export function fingerprint(type: SignalType, tokenAddress: string, eventId: string): string {
  const input = `${type}|${tokenAddress.toLowerCase()}|${eventId}`;
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

export function candidateFingerprint(c: SignalCandidate): string {
  return fingerprint(c.type, c.tokenAddress, c.eventId);
}

/** True when the storage layer is ready (table exists and is reachable). */
export async function storageReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from(SIGNAL_TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}

export type ReservationOutcome =
  | { reserved: true; id: string; fingerprint: string }
  | { reserved: false; reason: "duplicate" | "retry-limit"; fingerprint: string };

/**
 * Atomically claims the right to publish a signal. A unique-violation means the
 * event was already processed → the caller MUST NOT send.
 */
export async function reserve(candidate: SignalCandidate, symbol: string | null): Promise<ReservationOutcome> {
  const fp = candidateFingerprint(candidate);
  const c = await db();

  const { data, error } = await c
    .from(SIGNAL_TABLE)
    .insert({
      fingerprint: fp,
      signal_type: candidate.type,
      token_address: candidate.tokenAddress.toLowerCase(),
      token_symbol: symbol,
      event_id: candidate.eventId,
      tx_hash: candidate.txHash,
      metric: candidate.metric,
      status: "PENDING",
      payload: candidate.data as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) {
    if (missingTable(error.message)) throw new SignalStorageError(error.message);
    // 23505 = unique_violation → already processed.
    if (error.code === "23505" || /duplicate key/i.test(error.message)) {
      const attempts = await failedAttempts(fp);
      if (attempts > 0 && attempts < MAX_ATTEMPTS) {
        // Previous send failed: allow a bounded retry by reclaiming the row.
        const { error: upErr } = await c
          .from(SIGNAL_TABLE)
          .update({ status: "PENDING" })
          .eq("fingerprint", fp)
          .eq("status", "FAILED")
          .select("id")
          .single();
        if (!upErr) return { reserved: true, id: fp, fingerprint: fp };
      }
      return { reserved: false, reason: attempts >= MAX_ATTEMPTS ? "retry-limit" : "duplicate", fingerprint: fp };
    }
    throw new SignalStorageError(error.message);
  }
  return { reserved: true, id: data.id as string, fingerprint: fp };
}

async function failedAttempts(fp: string): Promise<number> {
  const c = await db();
  const { data } = await c.from(SIGNAL_TABLE).select("attempts,status").eq("fingerprint", fp).maybeSingle();
  const row = data as { attempts?: number; status?: string } | null;
  if (!row || row.status !== "FAILED") return 0;
  return row.attempts ?? 1;
}

export async function markSent(fp: string, messageId: number) {
  const c = await db();
  await c
    .from(SIGNAL_TABLE)
    .update({ status: "SENT", telegram_message_id: messageId, error: null, sent_at: new Date().toISOString() })
    .eq("fingerprint", fp);
}

export async function markFailed(fp: string, message: string, code: number | null) {
  const c = await db();
  const { data } = await c.from(SIGNAL_TABLE).select("attempts").eq("fingerprint", fp).maybeSingle();
  const attempts = ((data as { attempts?: number } | null)?.attempts ?? 0) + 1;
  await c
    .from(SIGNAL_TABLE)
    .update({ status: "FAILED", error: message.slice(0, 500), error_code: code, attempts })
    .eq("fingerprint", fp);
}

/** Records a signal that was intentionally NOT published, with its reason. */
export async function recordSkip(
  candidate: Pick<SignalCandidate, "type" | "tokenAddress" | "eventId" | "metric" | "txHash">,
  reason: string,
  symbol: string | null = null,
) {
  try {
    const c = await db();
    await c.from(SIGNAL_TABLE).insert({
      fingerprint: null,
      signal_type: candidate.type,
      token_address: candidate.tokenAddress.toLowerCase(),
      token_symbol: symbol,
      event_id: candidate.eventId,
      tx_hash: candidate.txHash,
      metric: candidate.metric,
      status: "SKIPPED",
      reason,
    });
  } catch {
    /* history must never break the run */
  }
}

/* ------------------------------- state reads ------------------------------- */

export type LastSignal = { created_at: string; metric: number | null; event_id: string | null };

/** Most recent SENT signal of a type (optionally for one token). */
export async function lastSent(type: SignalType, tokenAddress?: string): Promise<LastSignal | null> {
  const c = await db();
  let q = c
    .from(SIGNAL_TABLE)
    .select("created_at,metric,event_id")
    .eq("signal_type", type)
    .eq("status", "SENT")
    .order("created_at", { ascending: false })
    .limit(1);
  if (tokenAddress) q = q.eq("token_address", tokenAddress.toLowerCase());
  const { data, error } = await q;
  if (error) {
    if (missingTable(error.message)) throw new SignalStorageError(error.message);
    return null;
  }
  return (data?.[0] as LastSignal) ?? null;
}

/** Highest metric ever published for a type+token (last ATH, last milestone…). */
export async function highestMetric(type: SignalType, tokenAddress: string): Promise<number | null> {
  const c = await db();
  const { data } = await c
    .from(SIGNAL_TABLE)
    .select("metric")
    .eq("signal_type", type)
    .eq("status", "SENT")
    .eq("token_address", tokenAddress.toLowerCase())
    .order("metric", { ascending: false })
    .limit(1);
  const m = (data?.[0] as { metric: number | null } | undefined)?.metric;
  return m == null ? null : Number(m);
}

export function cooldownActive(last: LastSignal | null, minutes: number): boolean {
  if (!last || minutes <= 0) return false;
  return Date.now() - Date.parse(last.created_at) < minutes * 60_000;
}

/** True when nothing has ever been recorded → first run must not blast history. */
export async function isFirstRun(): Promise<boolean> {
  const c = await db();
  const { count, error } = await c.from(SIGNAL_TABLE).select("id", { count: "exact", head: true });
  if (error) {
    if (missingTable(error.message)) throw new SignalStorageError(error.message);
    return false;
  }
  return (count ?? 0) === 0;
}

/** Marks a candidate as the baseline of the first run (recorded, never sent). */
export async function recordBaseline(candidate: SignalCandidate, symbol: string | null) {
  try {
    const c = await db();
    await c.from(SIGNAL_TABLE).insert({
      fingerprint: candidateFingerprint(candidate),
      signal_type: candidate.type,
      token_address: candidate.tokenAddress.toLowerCase(),
      token_symbol: symbol,
      event_id: candidate.eventId,
      tx_hash: candidate.txHash,
      metric: candidate.metric,
      status: "SKIPPED",
      reason: "baseline-run",
    });
  } catch {
    /* ignore */
  }
}

export async function recentSignals(limit = 50): Promise<SignalLogRow[]> {
  const c = await db();
  const { data, error } = await c
    .from(SIGNAL_TABLE)
    .select(
      "id,created_at,signal_type,token_address,token_symbol,event_id,tx_hash,status,reason,error,metric,telegram_message_id",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) {
    if (missingTable(error.message)) throw new SignalStorageError(error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as SignalLogRow[];
}

export type SignalCounts = Record<SignalStatus | "TOTAL", number>;

export async function signalCounts(): Promise<SignalCounts> {
  const rows = await recentSignals(200);
  const out: SignalCounts = { SENT: 0, SKIPPED: 0, FAILED: 0, TOTAL: rows.length };
  rows.forEach((r) => {
    if (r.status === "SENT" || r.status === "SKIPPED" || r.status === "FAILED") out[r.status] += 1;
  });
  return out;
}
