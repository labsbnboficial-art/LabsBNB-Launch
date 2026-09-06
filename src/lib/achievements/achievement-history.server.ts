// 🏆 Creator Achievements (Fase 2D) — append-only persistence (service role).
//
// Table `creator_achievements` (see docs/SQL_CREATOR_ACHIEVEMENTS.md) is
// APPEND-ONLY: no UPDATE, no DELETE. Raising a threshold later never revokes a
// past unlock — the row stays and the UI marks it as a legacy badge.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import { normalizeAddress } from "./achievement-rules";
import type { AchievementCandidate, AchievementEntry, AchievementEvidence } from "./achievement-types";

const TABLE = "creator_achievements";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

type Row = {
  id: string;
  chain_id: number;
  creator_address: string;
  achievement_key: string;
  unlocked_at: string;
  source_type: string;
  source_id: string | null;
  evidence: AchievementEvidence | null;
  fingerprint: string;
  metadata: Record<string, unknown> | null;
};

function toEntry(r: Row): AchievementEntry {
  return {
    id: r.id,
    chainId: r.chain_id,
    creatorAddress: r.creator_address,
    achievementKey: r.achievement_key,
    unlockedAt: r.unlocked_at,
    sourceType: r.source_type,
    sourceId: r.source_id,
    evidence: r.evidence ?? {},
    fingerprint: r.fingerprint,
    backfill: (r.metadata ?? {})["backfill"] === true,
  };
}

export async function achievementsReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from(TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/** Unlocks of one creator, oldest first. */
export async function getCreatorAchievementRows(
  address: string,
  chainId: number = ACTIVE_CHAIN_ID,
): Promise<AchievementEntry[]> {
  const creator = normalizeAddress(address);
  const c = await db();
  const { data, error } = await c
    .from(TABLE)
    .select("*")
    .eq("chain_id", chainId)
    .eq("creator_address", creator)
    .order("unlocked_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toEntry);
}

/** Compact map creator → keys, for list views without N+1 queries. */
export async function achievementsByCreator(
  addresses: string[],
  chainId: number = ACTIVE_CHAIN_ID,
): Promise<Map<string, AchievementEntry[]>> {
  const map = new Map<string, AchievementEntry[]>();
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!list.length) return map;
  const c = await db();
  const { data, error } = await c
    .from(TABLE)
    .select("*")
    .eq("chain_id", chainId)
    .in("creator_address", list)
    .order("unlocked_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Row[]) {
    const entry = toEntry(row);
    const key = entry.creatorAddress.toLowerCase();
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/** Admin history feed with optional filters. */
export async function recentAchievements(
  chainId: number = ACTIVE_CHAIN_ID,
  limit = 50,
  filters: { creator?: string | null; key?: string | null; backfill?: boolean | null } = {},
): Promise<AchievementEntry[]> {
  const c = await db();
  let q = c
    .from(TABLE)
    .select("*")
    .eq("chain_id", chainId)
    .order("unlocked_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (filters.creator) q = q.eq("creator_address", normalizeAddress(filters.creator));
  if (filters.key) q = q.eq("achievement_key", filters.key);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let entries = ((data ?? []) as Row[]).map(toEntry);
  if (filters.backfill != null) entries = entries.filter((e) => e.backfill === filters.backfill);
  return entries;
}

/**
 * Inserts new unlocks. Idempotent at DB level through the UNIQUE fingerprint
 * index: concurrent runs can never duplicate an achievement.
 */
export async function recordAchievement(
  candidates: AchievementCandidate[],
): Promise<{ inserted: number; duplicates: number }> {
  if (!candidates.length) return { inserted: 0, duplicates: 0 };
  const c = await db();
  const rows = candidates.map((x) => ({
    chain_id: x.chainId,
    creator_address: x.creatorAddress.toLowerCase(),
    achievement_key: x.achievementKey,
    source_type: x.sourceType,
    source_id: x.sourceId,
    evidence: x.evidence,
    fingerprint: x.fingerprint,
    metadata: x.metadata,
  }));
  const { data, error } = await c
    .from(TABLE)
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  const inserted = (data ?? []).length;
  return { inserted, duplicates: rows.length - inserted };
}
