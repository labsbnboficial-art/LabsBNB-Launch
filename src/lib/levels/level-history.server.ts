// 🏆 Creator Level History (Fase 2C.1) — server-only persistence + sync.
//
// Table `creator_level_history` (see docs/SQL_CREATOR_LEVEL_HISTORY.md) is
// APPEND-ONLY: the app never updates or deletes rows. Level-down does not
// exist and configuration changes never rewrite past milestones.
//
// This module NEVER awards Creator Points: `creator_points_ledger` remains the
// single source of truth for points.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  detectMissingLevelMilestones,
  normalizeAddress,
  type LevelHistoryEntry,
  type LevelMilestone,
} from "./level-history-rules";
import { calculateCreatorLevel } from "./levels-rules";
import type { CreatorLevelsConfig } from "./levels-types";

const TABLE = "creator_level_history";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

type Row = {
  id: string;
  chain_id: number;
  creator_address: string;
  previous_level: number | null;
  new_level: number;
  points_at_level_up: number;
  milestone_key: string;
  source: string;
  fingerprint: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function toEntry(r: Row): LevelHistoryEntry {
  const metadata = r.metadata ?? {};
  return {
    id: r.id,
    chainId: r.chain_id,
    creatorAddress: r.creator_address,
    previousLevel: r.previous_level,
    newLevel: r.new_level,
    pointsAtLevelUp: Number(r.points_at_level_up),
    milestoneKey: r.milestone_key,
    source: r.source,
    fingerprint: r.fingerprint,
    metadata,
    createdAt: r.created_at,
    backfill: metadata["backfill"] === true,
  };
}

export async function historyReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from(TABLE).select("id").limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "unavailable" };
  }
}

/** Public read: full milestone history of one creator, oldest first. */
export async function getCreatorLevelHistory(
  creatorAddress: string,
  chainId = ACTIVE_CHAIN_ID,
): Promise<LevelHistoryEntry[]> {
  const address = normalizeAddress(creatorAddress);
  try {
    const c = await db();
    const { data, error } = await c
      .from(TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .eq("creator_address", address)
      .order("new_level", { ascending: true })
      .limit(200);
    if (error || !data) return [];
    return (data as Row[]).map(toEntry);
  } catch {
    return [];
  }
}

/** Admin observability: latest milestones across all creators. */
export async function recentLevelHistory(
  chainId = ACTIVE_CHAIN_ID,
  limit = 50,
  filters: { creator?: string | null; level?: number | null; backfill?: boolean | null } = {},
): Promise<{ entries: LevelHistoryEntry[]; total: number }> {
  try {
    const c = await db();
    let q = c
      .from(TABLE)
      .select("*", { count: "exact" })
      .eq("chain_id", chainId)
      .order("created_at", { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)));
    if (filters.creator) q = q.eq("creator_address", filters.creator.toLowerCase());
    if (filters.level != null) q = q.eq("new_level", filters.level);
    const { data, error, count } = await q;
    if (error || !data) return { entries: [], total: 0 };
    let entries = (data as Row[]).map(toEntry);
    if (filters.backfill != null) entries = entries.filter((e) => e.backfill === filters.backfill);
    return { entries, total: count ?? entries.length };
  } catch {
    return { entries: [], total: 0 };
  }
}

/**
 * Append-only insert. Race-safe: relies on the UNIQUE index on `fingerprint`
 * with `ignoreDuplicates`, never on a read-then-write check.
 */
export async function recordLevelUp(
  milestones: LevelMilestone[],
): Promise<{ inserted: number; duplicates: number; error: string | null }> {
  if (!milestones.length) return { inserted: 0, duplicates: 0, error: null };
  try {
    const c = await db();
    const rows = milestones.map((m) => ({
      chain_id: m.chainId,
      creator_address: m.creatorAddress,
      previous_level: m.previousLevel,
      new_level: m.newLevel,
      points_at_level_up: m.pointsAtLevelUp,
      milestone_key: m.milestoneKey,
      source: m.source,
      fingerprint: m.fingerprint,
      metadata: m.metadata,
    }));
    const { data, error } = await c
      .from(TABLE)
      .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, duplicates: 0, error: error.message };
    const inserted = (data as { id: string }[] | null)?.length ?? 0;
    return { inserted, duplicates: rows.length - inserted, error: null };
  } catch (e) {
    return { inserted: 0, duplicates: 0, error: e instanceof Error ? e.message : "insert failed" };
  }
}

export type SyncResult = {
  creator: string;
  totalPoints: number;
  currentLevel: number;
  detected: number;
  inserted: number;
  existing: number;
  error: string | null;
};

/**
 * Detector: points → level → compare with persisted milestones → insert gaps.
 * Deterministic, idempotent and safe under concurrent executions.
 */
export async function syncCreatorLevelHistory(
  creatorAddress: string,
  opts: { config?: CreatorLevelsConfig; totalPoints?: number; backfill?: boolean; chainId?: number } = {},
): Promise<SyncResult> {
  const chainId = opts.chainId ?? ACTIVE_CHAIN_ID;
  const address = normalizeAddress(creatorAddress);
  const cfgMod = await import("./levels-config.server");
  const config: CreatorLevelsConfig = opts.config ?? (await cfgMod.loadLevelsConfig());

  let totalPoints = opts.totalPoints;
  if (totalPoints == null) {
    const store = await import("@/lib/points/points-store.server");
    totalPoints = (await store.creatorTotals(chainId, address)).totalPoints;
  }

  const current = calculateCreatorLevel(totalPoints, config).level;
  if (!config.enabled) {
    return { creator: address, totalPoints, currentLevel: current, detected: 0, inserted: 0, existing: 0, error: null };
  }

  const existing = await getCreatorLevelHistory(address, chainId);
  const missing = await detectMissingLevelMilestones({
    chainId,
    creatorAddress: address,
    totalPoints,
    existingLevels: existing.map((e) => e.newLevel),
    config,
    ...(opts.backfill ? { backfill: true } : {}),
  });

  const res = await recordLevelUp(missing);
  return {
    creator: address,
    totalPoints,
    currentLevel: current,
    detected: missing.length,
    inserted: res.inserted,
    existing: existing.length + res.duplicates,
    error: res.error,
  };
}

export type LevelHistoryRunResult = {
  trigger: string;
  startedAt: string;
  completedAt: string;
  creatorsScanned: number;
  milestonesDetected: number;
  milestonesInserted: number;
  alreadyExisting: number;
  errors: number;
  lastError: string | null;
  durationMs: number;
  status: "ok" | "error";
};

/**
 * Batch sync over every creator with points (single batched read of the
 * ledger totals — no N+1 over `creator_points_ledger`).
 */
export async function runLevelHistorySync(
  trigger: string,
  opts: { backfill?: boolean; chainId?: number } = {},
): Promise<LevelHistoryRunResult> {
  const chainId = opts.chainId ?? ACTIVE_CHAIN_ID;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  let creatorsScanned = 0;
  let detected = 0;
  let inserted = 0;
  let existing = 0;
  let errors = 0;
  let lastError: string | null = null;

  try {
    const [store, { loadLevelsConfig }] = await Promise.all([
      import("@/lib/points/points-store.server"),
      import("./levels-config.server"),
    ]);
    const config = await loadLevelsConfig();
    const totals = await store.totalsByCreator(chainId);

    for (const [creator, points] of totals) {
      if (points <= 0) continue;
      creatorsScanned += 1;
      try {
        const r = await syncCreatorLevelHistory(creator, {
          config,
          totalPoints: points,
          chainId,
          ...(opts.backfill ? { backfill: true } : {}),
        });
        detected += r.detected;
        inserted += r.inserted;
        existing += r.existing;
        if (r.error) {
          errors += 1;
          lastError = r.error;
        }
      } catch (e) {
        errors += 1;
        lastError = e instanceof Error ? e.message : "sync failed";
      }
    }
  } catch (e) {
    errors += 1;
    lastError = e instanceof Error ? e.message : "level history sync failure";
  }

  const completed = Date.now();
  const result: LevelHistoryRunResult = {
    trigger,
    startedAt,
    completedAt: new Date(completed).toISOString(),
    creatorsScanned,
    milestonesDetected: detected,
    milestonesInserted: inserted,
    alreadyExisting: existing,
    errors,
    lastError,
    durationMs: completed - startedAtMs,
    status: errors === 0 ? "ok" : "error",
  };

  console.info(
    `[CREATOR_LEVEL_HISTORY] run (${trigger}${opts.backfill ? ", backfill" : ""}) — creators ${creatorsScanned} · detected ${detected} · inserted ${inserted} · existing ${existing} · errors ${errors} · ${result.durationMs}ms`,
  );
  return result;
}

/** Initial migration for creators that already had points before Fase 2C.1. */
export async function backfillCreatorLevelHistory(chainId = ACTIVE_CHAIN_ID) {
  return runLevelHistorySync("backfill", { backfill: true, chainId });
}
