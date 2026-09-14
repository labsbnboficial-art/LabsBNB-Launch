// 🎁 Fase 2G — Allocation persistence (service role, server only).
//
//   • config  → `admin_config` key `creator_reward_allocation:<programId>`
//               (same infra as Points/Leaderboard/Rewards: no new config table)
//   • input   → READ-ONLY of `creator_reward_eligibility_snapshots` (Fase 2F)
//   • output  → `creator_reward_allocation_snapshots` (append-only, UNIQUE
//               fingerprint) created by docs/SQL_CREATOR_REWARD_ALLOCATION.md
//
// Nothing here updates or deletes a snapshot, and nothing here touches the
// eligibility tables.
import {
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationConfig,
  type AllocationConfigRecord,
  type AllocationConfigVersion,
  type AllocationEngineState,
  type AllocationInput,
  type AllocationMethod,
  type AllocationSnapshotRecord,
  type AllocationSnapshotRow,
  type AllocationStatus,
  EMPTY_ALLOCATION_STATE,
} from "./allocation-types";
import { validateAllocationConfig } from "./allocation-rules";
import type { EligibilityStatus } from "./rewards-types";
import { SNAPSHOTS_TABLE } from "./rewards-store.server";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export const ALLOCATION_SNAPSHOTS_TABLE = "creator_reward_allocation_snapshots";
export const ALLOCATION_STATE_KEY = "creator_reward_allocation_state";
export const allocationConfigKey = (programId: string) => `creator_reward_allocation:${programId}`;

type Ready = { ready: boolean; error: string | null };

export async function allocationReady(): Promise<Ready> {
  try {
    const c = await db();
    const { error } = await c.from(ALLOCATION_SNAPSHOTS_TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/* --------------------------------- config ---------------------------------- */

type StoredConfig = { version: number; config: unknown; updatedAt: string; history?: unknown[] };

function parseHistory(raw: unknown[] | undefined): AllocationConfigVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: AllocationConfigVersion[] = [];
  for (const entry of raw) {
    const e = (entry ?? {}) as Partial<AllocationConfigVersion> & { config?: unknown };
    try {
      out.push({
        version: Number(e.version ?? 1),
        config: validateAllocationConfig(e.config),
        note: typeof e.note === "string" ? e.note : null,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date(0).toISOString(),
      });
    } catch {
      /* a corrupt history entry never blocks the current config */
    }
  }
  return out.sort((a, b) => b.version - a.version).slice(0, 50);
}

export async function loadAllocationConfig(programId: string): Promise<AllocationConfigRecord> {
  const fallback: AllocationConfigRecord = {
    programId,
    version: 1,
    config: DEFAULT_ALLOCATION_CONFIG,
    updatedAt: new Date(0).toISOString(),
    history: [],
  };
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", allocationConfigKey(programId)).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return fallback;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as StoredConfig;
    return {
      programId,
      version: Number(parsed.version ?? 1),
      config: validateAllocationConfig(parsed.config),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
      history: parseHistory(parsed.history),
    };
  } catch {
    return fallback;
  }
}

/** §versioning — saving ALWAYS bumps the version and appends to the history. */
export async function saveAllocationConfig(
  programId: string,
  config: AllocationConfig,
  note: string | null,
): Promise<AllocationConfigRecord> {
  const current = await loadAllocationConfig(programId);
  const version = current.version + 1;
  const updatedAt = new Date().toISOString();
  const history: AllocationConfigVersion[] = [
    { version, config, note, createdAt: updatedAt },
    ...current.history,
  ].slice(0, 50);
  const c = await db();
  const { error } = await c
    .from("admin_config")
    .upsert(
      { key: allocationConfigKey(programId), value: { version, config, updatedAt, history }, is_public: false },
      { onConflict: "key" },
    );
  if (error) throw new Error(`No se pudo guardar la configuración de Allocation: ${error.message}`);
  return { programId, version, config, updatedAt, history };
}

/* ---------------------------------- state ---------------------------------- */

export async function loadAllocationState(): Promise<AllocationEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", ALLOCATION_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_ALLOCATION_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<AllocationEngineState>;
    return { ...EMPTY_ALLOCATION_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_ALLOCATION_STATE;
  }
}

export async function saveAllocationState(state: AllocationEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: ALLOCATION_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[REWARD_ALLOCATION] state not persisted: ${error.message}`);
  } catch {
    console.error("[REWARD_ALLOCATION] state not persisted: storage unavailable");
  }
}

/* ------------------------- eligibility input (read) ------------------------- */

/**
 * Latest eligibility batch of a program: exactly the rows produced by the most
 * recent Fase 2F evaluation. Read-only; this never writes to eligibility.
 */
export async function latestEligibilityBatch(
  chainId: number,
  programId: string,
): Promise<{ inputs: AllocationInput[]; evaluatedAt: string | null; ruleVersion: number | null }> {
  const c = await db();
  const { data, error } = await c
    .from(SNAPSHOTS_TABLE)
    .select(
      "creator_address, status, eligibility_score, rule_version, points, creator_score, creator_level, achievements, graduations, organic_score, season_rank, evaluated_at, fingerprint",
    )
    .eq("chain_id", chainId)
    .eq("program_id", programId)
    .order("evaluated_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`No se pudieron leer las evaluaciones de elegibilidad: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return { inputs: [], evaluatedAt: null, ruleVersion: null };
  const evaluatedAt = String(rows[0]!["evaluated_at"]);
  const seen = new Set<string>();
  const inputs: AllocationInput[] = [];
  let ruleVersion: number | null = null;
  for (const r of rows) {
    if (String(r["evaluated_at"]) !== evaluatedAt) break;
    const address = String(r["creator_address"]).toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    const n = (k: string): number | null => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
    ruleVersion ??= Number(r["rule_version"] ?? 1);
    inputs.push({
      address,
      eligibilityStatus: String(r["status"]) as EligibilityStatus,
      eligibilityScore: Number(r["eligibility_score"] ?? 0),
      ruleVersion: Number(r["rule_version"] ?? 1),
      metrics: {
        points: n("points"),
        score: n("creator_score"),
        level: n("creator_level"),
        achievements: n("achievements"),
        graduations: n("graduations"),
        organic: n("organic_score"),
        seasonRank: n("season_rank"),
      },
      sourceFingerprint: String(r["fingerprint"]),
      evaluatedAt,
    });
  }
  return { inputs, evaluatedAt, ruleVersion };
}

/* --------------------------- allocation snapshots --------------------------- */

export async function appendAllocationSnapshots(
  rows: AllocationSnapshotRow[],
): Promise<{ inserted: number; duplicates: number; error: string | null }> {
  if (!rows.length) return { inserted: 0, duplicates: 0, error: null };
  try {
    const c = await db();
    const payload = rows.map((r) => ({
      chain_id: r.chainId,
      program_id: r.programId,
      rule_version: r.ruleVersion,
      allocation_version: r.allocationVersion,
      basis_hash: r.basisHash,
      eligibility_evaluated_at: r.eligibilityEvaluatedAt,
      creator_address: r.creatorAddress.toLowerCase(),
      eligibility_status: r.eligibilityStatus,
      status: r.status,
      allocation_score: r.allocationScore,
      normalized_weight: r.normalizedWeight,
      allocation_pct: r.allocationPct,
      allocation_amount: r.allocationAmount,
      pool_total: r.poolTotal,
      pool_unit: r.poolUnit,
      method: r.method,
      factors_result: r.factorsResult,
      reasons: r.reasons,
      evaluated_at: r.evaluatedAt,
      fingerprint: r.fingerprint,
    }));
    const { data, error } = await c
      .from(ALLOCATION_SNAPSHOTS_TABLE)
      .upsert(payload, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, duplicates: 0, error: error.message };
    const inserted = data?.length ?? 0;
    return { inserted, duplicates: rows.length - inserted, error: null };
  } catch (e) {
    return { inserted: 0, duplicates: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

const SNAPSHOT_COLUMNS =
  "creator_address, eligibility_status, status, allocation_score, normalized_weight, allocation_pct, allocation_amount, pool_total, pool_unit, method, rule_version, allocation_version, basis_hash, evaluated_at";

function toRecord(r: Record<string, unknown>): AllocationSnapshotRecord {
  const n = (k: string): number | null => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  return {
    creatorAddress: String(r["creator_address"]),
    eligibilityStatus: String(r["eligibility_status"]) as EligibilityStatus,
    status: String(r["status"]) as AllocationStatus,
    allocationScore: n("allocation_score"),
    normalizedWeight: n("normalized_weight"),
    allocationPct: n("allocation_pct"),
    allocationAmount: n("allocation_amount"),
    poolTotal: n("pool_total"),
    poolUnit: (r["pool_unit"] as string | null) ?? null,
    method: String(r["method"]) as AllocationMethod,
    ruleVersion: Number(r["rule_version"] ?? 1),
    allocationVersion: Number(r["allocation_version"] ?? 1),
    basisHash: String(r["basis_hash"]),
    evaluatedAt: String(r["evaluated_at"]),
  };
}

/** Latest stored allocation batch of a program (immutable read). */
export async function latestAllocationBatch(chainId: number, programId: string): Promise<AllocationSnapshotRecord[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(ALLOCATION_SNAPSHOTS_TABLE)
      .select(SNAPSHOT_COLUMNS)
      .eq("chain_id", chainId)
      .eq("program_id", programId)
      .order("evaluated_at", { ascending: false })
      .limit(5000);
    if (error || !data?.length) return [];
    const rows = (data as Record<string, unknown>[]).map(toRecord);
    const last = rows[0]!.evaluatedAt;
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (r.evaluatedAt !== last || seen.has(r.creatorAddress)) return false;
      seen.add(r.creatorAddress);
      return true;
    });
  } catch {
    return [];
  }
}

export async function latestAllocationFor(
  chainId: number,
  programId: string,
  creatorAddress: string,
): Promise<AllocationSnapshotRecord | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(ALLOCATION_SNAPSHOTS_TABLE)
      .select(SNAPSHOT_COLUMNS)
      .eq("chain_id", chainId)
      .eq("program_id", programId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("evaluated_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    return toRecord(data[0] as Record<string, unknown>);
  } catch {
    return null;
  }
}
