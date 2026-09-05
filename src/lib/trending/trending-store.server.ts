// Trending Engine — snapshot persistence (`public.trending_snapshots`).
//
// The table is created by `docs/SQL_TRENDING_ENGINE.md`. Until it exists the
// engine keeps working and serves the ranking from the in-process cache, so
// the launchpad never breaks because of a pending migration.
import type { TrendingRow } from "./trending-types";

export type SnapshotRow = {
  token_address: string;
  chain_id: number;
  timestamp: string;
  volume_5m: number;
  volume_15m: number;
  volume_1h: number;
  volume_6h: number;
  volume_24h: number;
  trades_5m: number;
  trades_15m: number;
  buyers_5m: number;
  buyers_15m: number;
  sellers_5m: number;
  sellers_15m: number;
  holders: number | null;
  bonding_progress: number | null;
  whale_score: number;
  trending_score: number;
  velocity_score: number | null;
  payload: TrendingRow;
};

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const MISSING_TABLE = /relation .*trending_snapshots.* does not exist|schema cache/i;

export async function snapshotsReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from("trending_snapshots").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export async function saveSnapshots(rows: SnapshotRow[]): Promise<{ saved: number; error: string | null }> {
  if (!rows.length) return { saved: 0, error: null };
  try {
    const c = await db();
    const { error } = await c.from("trending_snapshots").insert(rows);
    if (error) {
      if (!MISSING_TABLE.test(error.message)) console.error(`[TRENDING_ENGINE] snapshot insert failed: ${error.message}`);
      return { saved: 0, error: error.message };
    }
    return { saved: rows.length, error: null };
  } catch (e) {
    return { saved: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/** Latest stored ranking (one row per token), newest first. */
export async function latestRanking(chainId: number, maxAgeMinutes = 20): Promise<TrendingRow[]> {
  try {
    const c = await db();
    const since = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    const { data, error } = await c
      .from("trending_snapshots")
      .select("token_address,timestamp,payload")
      .eq("chain_id", chainId)
      .gte("timestamp", since)
      .order("timestamp", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    const seen = new Set<string>();
    const rows: TrendingRow[] = [];
    for (const r of data as { token_address: string; payload: TrendingRow | null }[]) {
      const key = r.token_address.toLowerCase();
      if (seen.has(key) || !r.payload) continue;
      seen.add(key);
      rows.push(r.payload);
    }
    return rows.sort((a, b) => b.trendingScore - a.trendingScore).map((r, i) => ({ ...r, rank: i + 1 }));
  } catch {
    return [];
  }
}

/** Holder count from the previous snapshot, used for real holder growth. */
export async function previousHolders(chainId: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const c = await db();
    const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const { data, error } = await c
      .from("trending_snapshots")
      .select("token_address,holders,timestamp")
      .eq("chain_id", chainId)
      .gte("timestamp", since)
      .order("timestamp", { ascending: false })
      .limit(500);
    if (error || !data) return out;
    for (const r of data as { token_address: string; holders: number | null }[]) {
      const key = r.token_address.toLowerCase();
      if (out.has(key) || r.holders == null) continue;
      out.set(key, r.holders);
    }
  } catch {
    /* no history yet */
  }
  return out;
}
