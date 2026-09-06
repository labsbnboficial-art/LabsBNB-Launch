// 🏆 Creator Points — append-only ledger persistence (service role, server only).
//
// The table is created by `docs/SQL_CREATOR_POINTS.md`. The app NEVER updates or
// deletes ledger rows: corrections are made with a compensating
// `ADMIN_ADJUSTMENT` entry so history stays immutable and auditable.
import type { PointsCandidate, PointsEventType, PointsLedgerEntry } from "./points-types";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const TABLE = "creator_points_ledger";

type Row = {
  id: string;
  creator_address: string;
  chain_id: number;
  event_type: string;
  source_id: string | null;
  source_ref: string | null;
  token_address: string | null;
  points: number;
  base_points: number;
  multiplier: number | string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  fingerprint: string;
  created_at: string;
};

function toEntry(r: Row): PointsLedgerEntry {
  return {
    id: r.id,
    creatorAddress: r.creator_address,
    chainId: r.chain_id,
    eventType: r.event_type as PointsEventType,
    sourceId: r.source_id,
    sourceRef: r.source_ref,
    tokenAddress: r.token_address,
    points: Number(r.points),
    basePoints: Number(r.base_points),
    multiplier: Number(r.multiplier),
    reason: r.reason,
    metadata: r.metadata,
    fingerprint: r.fingerprint,
    createdAt: r.created_at,
  };
}

export async function ledgerReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from(TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/** Fingerprints already stored, used to skip duplicates before inserting. */
export async function existingFingerprints(fingerprints: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!fingerprints.length) return out;
  const c = await db();
  const CHUNK = 200;
  for (let i = 0; i < fingerprints.length; i += CHUNK) {
    const slice = fingerprints.slice(i, i + CHUNK);
    const { data, error } = await c.from(TABLE).select("fingerprint").in("fingerprint", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { fingerprint: string }[]) out.add(r.fingerprint);
  }
  return out;
}

/**
 * Appends new entries. `ignoreDuplicates` upsert on the UNIQUE fingerprint makes
 * the write itself idempotent even under concurrent runs.
 */
export async function appendLedger(candidates: PointsCandidate[]): Promise<{ inserted: number; error: string | null }> {
  if (!candidates.length) return { inserted: 0, error: null };
  try {
    const c = await db();
    const rows = candidates.map((k) => ({
      creator_address: k.creatorAddress.toLowerCase(),
      chain_id: k.chainId,
      event_type: k.eventType,
      source_id: k.sourceId,
      source_ref: k.sourceRef,
      token_address: k.tokenAddress ? k.tokenAddress.toLowerCase() : null,
      points: k.points,
      base_points: k.basePoints,
      multiplier: k.multiplier,
      reason: k.reason,
      metadata: k.metadata,
      fingerprint: k.fingerprint,
    }));
    const { data, error } = await c
      .from(TABLE)
      .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, error: error.message };
    return { inserted: (data ?? []).length, error: null };
  } catch (e) {
    return { inserted: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/** Points awarded today (UTC) grouped by `${token}|${eventType}` — daily caps. */
export async function todayPointsByTokenEvent(chainId: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const c = await db();
    const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const { data, error } = await c
      .from(TABLE)
      .select("token_address,event_type,points,creator_address")
      .eq("chain_id", chainId)
      .gte("created_at", since)
      .limit(5000);
    if (error || !data) return out;
    for (const r of data as Pick<Row, "token_address" | "event_type" | "points" | "creator_address">[]) {
      const tokenKey = `${r.token_address ?? "-"}|${r.event_type}`;
      out.set(tokenKey, (out.get(tokenKey) ?? 0) + Number(r.points));
      const creatorKey = `creator:${r.creator_address}|${r.event_type}`;
      out.set(creatorKey, (out.get(creatorKey) ?? 0) + 1); // count, used by TOKEN_CREATED cap
    }
    return out;
  } catch {
    return out;
  }
}

export type PointsTotals = {
  totalPoints: number;
  pointsToday: number;
  pointsThisMonth: number;
  events: number;
  lastEventAt: string | null;
};

export async function creatorTotals(chainId: number, creatorAddress: string): Promise<PointsTotals> {
  const empty: PointsTotals = { totalPoints: 0, pointsToday: 0, pointsThisMonth: 0, events: 0, lastEventAt: null };
  try {
    const c = await db();
    const { data, error } = await c
      .from(TABLE)
      .select("points,created_at")
      .eq("chain_id", chainId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error || !data) return empty;
    const rows = data as { points: number; created_at: string }[];
    const dayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const monthStart = Date.parse(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
    let total = 0;
    let today = 0;
    let month = 0;
    for (const r of rows) {
      const p = Number(r.points);
      const at = Date.parse(r.created_at);
      total += p;
      if (at >= dayStart) today += p;
      if (at >= monthStart) month += p;
    }
    return {
      totalPoints: total,
      pointsToday: today,
      pointsThisMonth: month,
      events: rows.length,
      lastEventAt: rows[0]?.created_at ?? null,
    };
  } catch {
    return empty;
  }
}

export async function creatorHistory(
  chainId: number,
  creatorAddress: string,
  limit: number,
  offset: number,
): Promise<{ entries: PointsLedgerEntry[]; total: number }> {
  try {
    const c = await db();
    const { data, error, count } = await c
      .from(TABLE)
      .select("*", { count: "exact" })
      .eq("chain_id", chainId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error || !data) return { entries: [], total: 0 };
    return { entries: (data as Row[]).map(toEntry), total: count ?? data.length };
  } catch {
    return { entries: [], total: 0 };
  }
}

/** Latest ledger entries across all creators (admin observability). */
export async function recentLedger(chainId: number, limit = 25): Promise<PointsLedgerEntry[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Row[]).map(toEntry);
  } catch {
    return [];
  }
}

/** Points totals per creator, used by the `/creators` Points column. */
export async function totalsByCreator(chainId: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const c = await db();
    const { data, error } = await c
      .from(TABLE)
      .select("creator_address,points")
      .eq("chain_id", chainId)
      .limit(20_000);
    if (error || !data) return out;
    for (const r of data as { creator_address: string; points: number }[]) {
      out.set(r.creator_address, (out.get(r.creator_address) ?? 0) + Number(r.points));
    }
    return out;
  } catch {
    return out;
  }
}
