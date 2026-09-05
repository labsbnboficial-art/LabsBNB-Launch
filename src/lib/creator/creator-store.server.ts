// Creator system — persistence reads (service role, server only).
//
//  • `trending_snapshots` → historical trending facts (best rank, Top5/Top10,
//    Rising Fast, near graduation) so the Creator System CONSUMES the Trending
//    Engine instead of duplicating it.
//  • `tokens`             → launch dates / graduation dates (chain 56 only).
//  • `creator_profiles`   → optional, sanitised customisation (never stats).
import type { TrendingRow } from "@/lib/trending/trending-types";
import {
  EMPTY_CUSTOMIZATION,
  type CreatorCustomization,
  type CreatorEvent,
  type TokenTrendingHistory,
} from "./creator-types";
import type { TokenDbInfo } from "./creator-score";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

/**
 * Aggregates the stored trending history for the given chain.
 * Returns one entry per token address (lowercase).
 */
export async function loadTrendingHistory(chainId: number, days = 30): Promise<Map<string, TokenTrendingHistory>> {
  const out = new Map<string, TokenTrendingHistory>();
  try {
    const c = await db();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await c
      .from("trending_snapshots")
      .select("token_address,timestamp,trending_score,velocity_score,bonding_progress,payload")
      .eq("chain_id", chainId)
      .gte("timestamp", since)
      .order("timestamp", { ascending: true })
      .limit(5000);
    if (error || !data) return out;

    for (const raw of data as {
      token_address: string;
      timestamp: string;
      trending_score: number | null;
      velocity_score: number | null;
      bonding_progress: number | null;
      payload: TrendingRow | null;
    }[]) {
      const key = raw.token_address.toLowerCase();
      const cur =
        out.get(key) ??
        ({
          bestRank: null,
          top5: 0,
          top10: 0,
          risingFast: 0,
          reachedNearGraduation: false,
          bestScore: null,
          firstSeenAt: raw.timestamp,
          events: [] as CreatorEvent[],
        } satisfies TokenTrendingHistory);

      const symbol = raw.payload?.symbol ?? "";
      const rank = raw.payload?.rank && raw.payload.rank > 0 ? raw.payload.rank : null;
      const badges = raw.payload?.badges ?? [];

      const push = (kind: CreatorEvent["kind"], detail: string | null) => {
        if (cur.events.some((e) => e.kind === kind)) return; // first occurrence only
        cur.events.push({ kind, at: raw.timestamp, token: key, symbol, detail });
      };

      if (rank != null) {
        if (cur.bestRank == null || rank < cur.bestRank) cur.bestRank = rank;
        if (rank <= 10) {
          cur.top10 += 1;
          push("trending_top10", `#${rank}`);
        }
        if (rank <= 5) {
          cur.top5 += 1;
          push("trending_top5", `#${rank}`);
        }
      }
      if (badges.includes("rising_fast") || (raw.velocity_score ?? 0) >= 50) {
        cur.risingFast += 1;
        push("rising_fast", raw.velocity_score == null ? null : `+${Math.round(raw.velocity_score)}%`);
      }
      if ((raw.bonding_progress ?? 0) >= 80) {
        cur.reachedNearGraduation = true;
        push("near_graduation", `${Math.round(raw.bonding_progress ?? 0)}%`);
      }
      if ((raw.bonding_progress ?? 0) >= 100) push("graduation", null);
      if ((raw.payload?.whaleTrades ?? 0) > 0) {
        push("whale_activity", `${raw.payload?.whaleTrades} trades ≥ whale size`);
      }
      if (raw.trending_score != null && (cur.bestScore == null || raw.trending_score > cur.bestScore)) {
        cur.bestScore = raw.trending_score;
      }
      out.set(key, cur);
    }
  } catch {
    /* history not available yet — profile still renders with live metrics */
  }
  return out;
}

/** Launch / graduation dates from the launchpad `tokens` table (Mainnet only). */
export async function loadTokenDbInfo(chainId: number, addresses: string[]): Promise<Map<string, TokenDbInfo>> {
  const out = new Map<string, TokenDbInfo>();
  if (!addresses.length) return out;
  try {
    const c = await db();
    const { data, error } = await c
      .from("tokens")
      .select("contract_address,created_at,graduated_at,chain_id")
      .eq("chain_id", chainId)
      .in("contract_address", addresses);
    if (error || !data) return out;
    for (const r of data as { contract_address: string | null; created_at: string; graduated_at: string | null }[]) {
      if (!r.contract_address) continue;
      out.set(r.contract_address.toLowerCase(), { createdAt: r.created_at, graduatedAt: r.graduated_at });
    }
  } catch {
    /* dates unavailable → UI shows N/A */
  }
  return out;
}

const MISSING = /creator_profiles/i;

/** Optional customisation. Missing table/row → empty (address stays identity). */
export async function loadCustomizations(
  chainId: number,
  addresses: string[],
): Promise<Map<string, CreatorCustomization>> {
  const out = new Map<string, CreatorCustomization>();
  if (!addresses.length) return out;
  try {
    const c = await db();
    const { data, error } = await c
      .from("creator_profiles")
      .select("creator_address,display_name,avatar_url,bio,twitter,telegram,website")
      .eq("chain_id", chainId)
      .in("creator_address", addresses);
    if (error || !data) {
      if (error && !MISSING.test(error.message)) console.error(`[CREATOR] profile read failed: ${error.message}`);
      return out;
    }
    for (const r of data as Record<string, string | null>[]) {
      const addr = (r["creator_address"] ?? "").toLowerCase();
      if (!addr) continue;
      out.set(addr, {
        displayName: r["display_name"] ?? null,
        avatarUrl: r["avatar_url"] ?? null,
        bio: r["bio"] ?? null,
        twitter: r["twitter"] ?? null,
        telegram: r["telegram"] ?? null,
        website: r["website"] ?? null,
      });
    }
  } catch {
    /* table not created yet */
  }
  return out;
}

export async function creatorProfilesReady(): Promise<{ ready: boolean; error: string | null }> {
  try {
    const c = await db();
    const { error } = await c.from("creator_profiles").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export { EMPTY_CUSTOMIZATION };
