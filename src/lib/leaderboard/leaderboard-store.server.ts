// 🏆 Fase 2E — Leaderboard + Seasons persistence (service role, server only).
//
// Tables created by `docs/SQL_CREATOR_LEADERBOARD.md`:
//   • creator_seasons                 — season definitions (admin managed)
//   • creator_leaderboard_snapshots   — append-only global ranking snapshots
//   • creator_season_snapshots        — append-only per-season ranking snapshots
//
// Snapshots are NEVER updated or deleted by the app: idempotency is guaranteed
// by a UNIQUE fingerprint plus `ignoreDuplicates` upserts.
import {
  DEFAULT_SEASON_RULES,
  type CreatorSeason,
  type LeaderboardSnapshotRow,
  type SeasonRules,
  type SeasonSnapshotRow,
  type SeasonStatus,
} from "./leaderboard-types";
import { validateSeasonRules } from "./leaderboard-rules";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export const SEASONS_TABLE = "creator_seasons";
export const SNAPSHOTS_TABLE = "creator_leaderboard_snapshots";
export const SEASON_SNAPSHOTS_TABLE = "creator_season_snapshots";

type Ready = { ready: boolean; error: string | null };

async function tableReady(table: string): Promise<Ready> {
  try {
    const c = await db();
    const { error } = await c.from(table).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export const leaderboardReady = () => tableReady(SNAPSHOTS_TABLE);
export const seasonsReady = () => tableReady(SEASONS_TABLE);

/* --------------------------------- seasons --------------------------------- */

type SeasonRow = {
  id: string;
  chain_id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  rules: unknown;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
};

function toSeason(r: SeasonRow): CreatorSeason {
  let rules: SeasonRules;
  try {
    rules = validateSeasonRules(typeof r.rules === "string" ? JSON.parse(r.rules) : r.rules);
  } catch {
    rules = DEFAULT_SEASON_RULES;
  }
  return {
    id: r.id,
    chainId: r.chain_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status as SeasonStatus,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    rules,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finalizedAt: r.finalized_at,
  };
}

export async function listSeasons(chainId: number): Promise<CreatorSeason[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SEASONS_TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .order("starts_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return (data as SeasonRow[]).map(toSeason);
  } catch {
    return [];
  }
}

export async function getSeasonBySlug(chainId: number, slug: string): Promise<CreatorSeason | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SEASONS_TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return toSeason(data as SeasonRow);
  } catch {
    return null;
  }
}

export async function getSeasonById(id: string): Promise<CreatorSeason | null> {
  try {
    const c = await db();
    const { data, error } = await c.from(SEASONS_TABLE).select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return toSeason(data as SeasonRow);
  } catch {
    return null;
  }
}

/** The single `active` season (§33: only one may exist at a time). */
export async function getActiveSeason(chainId: number): Promise<CreatorSeason | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SEASONS_TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .eq("status", "active")
      .order("starts_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    return toSeason(data[0] as SeasonRow);
  } catch {
    return null;
  }
}

export async function insertSeason(input: {
  chainId: number;
  name: string;
  slug: string;
  description: string | null;
  status: SeasonStatus;
  startsAt: string;
  endsAt: string;
  rules: SeasonRules;
}): Promise<CreatorSeason> {
  const c = await db();
  const { data, error } = await c
    .from(SEASONS_TABLE)
    .insert({
      chain_id: input.chainId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      status: input.status,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      rules: input.rules,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`No se pudo crear la temporada: ${error?.message ?? "sin datos"}`);
  return toSeason(data as SeasonRow);
}

export async function updateSeason(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    description: string | null;
    status: SeasonStatus;
    startsAt: string;
    endsAt: string;
    rules: SeasonRules;
    finalizedAt: string | null;
  }>,
): Promise<CreatorSeason> {
  const c = await db();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row["name"] = patch.name;
  if (patch.slug !== undefined) row["slug"] = patch.slug;
  if (patch.description !== undefined) row["description"] = patch.description;
  if (patch.status !== undefined) row["status"] = patch.status;
  if (patch.startsAt !== undefined) row["starts_at"] = patch.startsAt;
  if (patch.endsAt !== undefined) row["ends_at"] = patch.endsAt;
  if (patch.rules !== undefined) row["rules"] = patch.rules;
  if (patch.finalizedAt !== undefined) row["finalized_at"] = patch.finalizedAt;
  const { data, error } = await c.from(SEASONS_TABLE).update(row).eq("id", id).select("*").single();
  if (error || !data) throw new Error(`No se pudo actualizar la temporada: ${error?.message ?? "sin datos"}`);
  return toSeason(data as SeasonRow);
}

/* -------------------------- global ranking snapshots ------------------------ */

type SnapshotRow = {
  id: string;
  chain_id: number;
  creator_address: string;
  rank: number;
  overall_score: number | string;
  creator_points: number | null;
  creator_score: number | null;
  graduations: number | null;
  trending_metric: number | string | null;
  organic_metric: number | string | null;
  components: Record<string, number | null> | null;
  snapshot_at: string;
  fingerprint: string;
};

export async function appendLeaderboardSnapshots(
  rows: LeaderboardSnapshotRow[],
): Promise<{ inserted: number; duplicates: number; error: string | null }> {
  if (!rows.length) return { inserted: 0, duplicates: 0, error: null };
  try {
    const c = await db();
    const payload = rows.map((r) => ({
      chain_id: r.chainId,
      creator_address: r.creatorAddress.toLowerCase(),
      rank: r.rank,
      overall_score: r.overallScore,
      creator_points: r.creatorPoints,
      creator_score: r.creatorScore,
      graduations: r.graduations,
      trending_metric: r.trendingMetric,
      organic_metric: r.organicMetric,
      components: r.components,
      snapshot_at: r.snapshotAt,
      fingerprint: r.fingerprint,
    }));
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .upsert(payload, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, duplicates: 0, error: error.message };
    const inserted = (data ?? []).length;
    return { inserted, duplicates: rows.length - inserted, error: null };
  } catch (e) {
    return { inserted: 0, duplicates: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/**
 * Previous rank + all-time best/worst rank per creator, from the LAST snapshot
 * batch before `beforeSnapshotAt`. ONE query for every creator (no N+1).
 */
export async function rankHistory(
  chainId: number,
  beforeSnapshotAt?: string,
): Promise<Map<string, { previousRank: number | null; bestRank: number | null; worstRank: number | null }>> {
  const out = new Map<string, { previousRank: number | null; bestRank: number | null; worstRank: number | null }>();
  try {
    const c = await db();
    let query = c
      .from(SNAPSHOTS_TABLE)
      .select("creator_address,rank,snapshot_at")
      .eq("chain_id", chainId)
      .order("snapshot_at", { ascending: false })
      .limit(20_000);
    if (beforeSnapshotAt) query = query.lt("snapshot_at", beforeSnapshotAt);
    const { data, error } = await query;
    if (error || !data) return out;
    const rows = data as { creator_address: string; rank: number; snapshot_at: string }[];
    const latestBatch = rows[0]?.snapshot_at ?? null;
    for (const r of rows) {
      const key = r.creator_address.toLowerCase();
      const cur = out.get(key) ?? { previousRank: null, bestRank: null, worstRank: null };
      if (latestBatch && r.snapshot_at === latestBatch && cur.previousRank == null) cur.previousRank = r.rank;
      cur.bestRank = cur.bestRank == null ? r.rank : Math.min(cur.bestRank, r.rank);
      cur.worstRank = cur.worstRank == null ? r.rank : Math.max(cur.worstRank, r.rank);
      out.set(key, cur);
    }
    return out;
  } catch {
    return out;
  }
}

/** Latest stored ranking batch — used as a cache/fallback when RPC degrades. */
export async function latestSnapshotBatch(chainId: number): Promise<{ snapshotAt: string | null; rows: SnapshotRow[] }> {
  try {
    const c = await db();
    const { data: head } = await c
      .from(SNAPSHOTS_TABLE)
      .select("snapshot_at")
      .eq("chain_id", chainId)
      .order("snapshot_at", { ascending: false })
      .limit(1);
    const snapshotAt = (head as { snapshot_at: string }[] | null)?.[0]?.snapshot_at ?? null;
    if (!snapshotAt) return { snapshotAt: null, rows: [] };
    const { data } = await c
      .from(SNAPSHOTS_TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .eq("snapshot_at", snapshotAt)
      .order("rank", { ascending: true })
      .limit(1000);
    return { snapshotAt, rows: (data ?? []) as SnapshotRow[] };
  } catch {
    return { snapshotAt: null, rows: [] };
  }
}

export async function creatorSnapshotHistory(
  chainId: number,
  creatorAddress: string,
  limit = 50,
): Promise<{ rank: number; overallScore: number; snapshotAt: string }[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .select("rank,overall_score,snapshot_at")
      .eq("chain_id", chainId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("snapshot_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as { rank: number; overall_score: number | string; snapshot_at: string }[]).map((r) => ({
      rank: r.rank,
      overallScore: Number(r.overall_score),
      snapshotAt: r.snapshot_at,
    }));
  } catch {
    return [];
  }
}

/* -------------------------- season ranking snapshots ------------------------ */

type SeasonSnapRow = SnapshotRow & { season_id: string; season_score: number | string; is_final: boolean };

export async function appendSeasonSnapshots(
  rows: SeasonSnapshotRow[],
): Promise<{ inserted: number; duplicates: number; error: string | null }> {
  if (!rows.length) return { inserted: 0, duplicates: 0, error: null };
  try {
    const c = await db();
    const payload = rows.map((r) => ({
      chain_id: r.chainId,
      season_id: r.seasonId,
      creator_address: r.creatorAddress.toLowerCase(),
      rank: r.rank,
      season_score: r.seasonScore,
      overall_score: r.overallScore,
      creator_points: r.creatorPoints,
      creator_score: r.creatorScore,
      graduations: r.graduations,
      trending_metric: r.trendingMetric,
      organic_metric: r.organicMetric,
      components: r.components,
      is_final: r.isFinal,
      snapshot_at: r.snapshotAt,
      fingerprint: r.fingerprint,
    }));
    const { data, error } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .upsert(payload, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, duplicates: 0, error: error.message };
    const inserted = (data ?? []).length;
    return { inserted, duplicates: rows.length - inserted, error: null };
  } catch (e) {
    return { inserted: 0, duplicates: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export type SeasonStanding = {
  creatorAddress: string;
  rank: number;
  seasonScore: number;
  creatorPoints: number | null;
  creatorScore: number | null;
  graduations: number | null;
  trendingMetric: number | null;
  organicMetric: number | null;
  snapshotAt: string;
  isFinal: boolean;
};

function toStanding(r: SeasonSnapRow): SeasonStanding {
  return {
    creatorAddress: r.creator_address,
    rank: r.rank,
    seasonScore: Number(r.season_score),
    creatorPoints: r.creator_points,
    creatorScore: r.creator_score,
    graduations: r.graduations,
    trendingMetric: r.trending_metric == null ? null : Number(r.trending_metric),
    organicMetric: r.organic_metric == null ? null : Number(r.organic_metric),
    snapshotAt: r.snapshot_at,
    isFinal: Boolean(r.is_final),
  };
}

/** Latest (or final) standings of one season. Final snapshots always win. */
export async function seasonStandings(seasonId: string): Promise<{ standings: SeasonStanding[]; snapshotAt: string | null; final: boolean }> {
  try {
    const c = await db();
    const { data: finalRows } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .select("*")
      .eq("season_id", seasonId)
      .eq("is_final", true)
      .order("rank", { ascending: true })
      .limit(1000);
    const finals = (finalRows ?? []) as SeasonSnapRow[];
    if (finals.length) {
      return { standings: finals.map(toStanding), snapshotAt: finals[0]!.snapshot_at, final: true };
    }
    const { data: head } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .select("snapshot_at")
      .eq("season_id", seasonId)
      .order("snapshot_at", { ascending: false })
      .limit(1);
    const snapshotAt = (head as { snapshot_at: string }[] | null)?.[0]?.snapshot_at ?? null;
    if (!snapshotAt) return { standings: [], snapshotAt: null, final: false };
    const { data } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .select("*")
      .eq("season_id", seasonId)
      .eq("snapshot_at", snapshotAt)
      .order("rank", { ascending: true })
      .limit(1000);
    return { standings: ((data ?? []) as SeasonSnapRow[]).map(toStanding), snapshotAt, final: false };
  } catch {
    return { standings: [], snapshotAt: null, final: false };
  }
}

/** Best season rank of one creator (never modified retroactively). */
export async function creatorSeasonHistory(
  chainId: number,
  creatorAddress: string,
): Promise<Map<string, { bestRank: number; lastRank: number; lastScore: number }>> {
  const out = new Map<string, { bestRank: number; lastRank: number; lastScore: number }>();
  try {
    const c = await db();
    const { data, error } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .select("season_id,rank,season_score,snapshot_at")
      .eq("chain_id", chainId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("snapshot_at", { ascending: false })
      .limit(2000);
    if (error || !data) return out;
    for (const r of data as { season_id: string; rank: number; season_score: number | string }[]) {
      const cur = out.get(r.season_id);
      if (!cur) out.set(r.season_id, { bestRank: r.rank, lastRank: r.rank, lastScore: Number(r.season_score) });
      else cur.bestRank = Math.min(cur.bestRank, r.rank);
    }
    return out;
  } catch {
    return out;
  }
}

/** Unique creators with valid activity inside a season (§27). */
export async function seasonParticipants(seasonId: string): Promise<number> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SEASON_SNAPSHOTS_TABLE)
      .select("creator_address")
      .eq("season_id", seasonId)
      .limit(20_000);
    if (error || !data) return 0;
    return new Set((data as { creator_address: string }[]).map((r) => r.creator_address.toLowerCase())).size;
  } catch {
    return 0;
  }
}
