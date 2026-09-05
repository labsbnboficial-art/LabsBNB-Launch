// Creator reputation — deterministic, pure, server-side scoring.
//
// No network, no database, no randomness: given the real per-token metrics
// produced by the Trending Engine (which already damps wash trading through
// its Organic Activity Score) these functions return the Creator Score,
// badges, stats, best performer and activity timeline.
//
// Missing data is NEVER invented: a component that has no real input is
// `null` and its weight is redistributed over the components that do.

import type { TrendingRow } from "@/lib/trending/trending-types";
import {
  CREATOR_WEIGHTS,
  EMPTY_HISTORY,
  type CreatorBadge,
  type CreatorEvent,
  type CreatorScoreParts,
  type CreatorStats,
  type CreatorTokenRow,
  type CreatorTokenStatus,
  type TokenTrendingHistory,
} from "./creator-types";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Saturating normaliser: 0 → 0, k → 0.5, ∞ → 1 (keeps absolutes from winning). */
export function sat(value: number, k: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + k);
}

/** Canonical creator identity. Returns `null` for anything that is not an address. */
export function normalizeCreatorAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  if (/^0x0{40}$/.test(v)) return null;
  return v.toLowerCase();
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function tokenStatus(row: {
  graduated: boolean;
  bondingProgress: number | null;
  trades24h: number;
  holders: number | null;
}): CreatorTokenStatus {
  if (row.graduated) return "graduated";
  if ((row.bondingProgress ?? 0) >= 80) return "near_graduation";
  if (row.trades24h > 0 || (row.holders ?? 0) > 1) return "active";
  return "idle";
}

/**
 * Objective per-token performance (0..1) used for the 🏆 Best Performer.
 * Deliberately NOT price based: organic volume, holders, bonding, graduation
 * and trending placement.
 */
export function performanceScore(t: {
  volume24h: number;
  organicScore: number;
  holders: number | null;
  bondingProgress: number | null;
  graduated: boolean;
  bestTrendingRank: number | null;
}): number {
  const organicVolume = t.volume24h * (t.organicScore / 100);
  const rank = t.bestTrendingRank == null ? 0 : clamp01((11 - t.bestTrendingRank) / 10);
  return (
    0.3 * sat(organicVolume, 1) +
    0.2 * sat(t.holders ?? 0, 25) +
    0.2 * clamp01((t.bondingProgress ?? 0) / 100) +
    0.15 * (t.graduated ? 1 : 0) +
    0.15 * rank
  );
}

export type TokenDbInfo = { createdAt: string | null; graduatedAt: string | null };

/** Enriches a Trending Engine row into a creator-token row. */
export function buildCreatorToken(
  row: TrendingRow,
  history: TokenTrendingHistory = EMPTY_HISTORY,
  db: TokenDbInfo = { createdAt: null, graduatedAt: null },
): CreatorTokenRow {
  const base = {
    address: row.address,
    name: row.name,
    symbol: row.symbol,
    logo: row.logo,
    price: row.price,
    priceChange24h: row.priceChange24h,
    volume24h: row.volumes["24h"] ?? 0,
    volume1h: row.volumes["1h"] ?? 0,
    trades24h: row.trades,
    buyers: row.buyers,
    sellers: row.sellers,
    holders: row.holders,
    bondingProgress: row.bondingProgress,
    graduated: row.graduated,
    trendingScore: row.trendingScore,
    trendingRank: row.rank > 0 ? row.rank : null,
    bestTrendingRank: history.bestRank ?? (row.rank > 0 ? row.rank : null),
    velocityScore: row.velocityScore,
    organicScore: row.organicScore,
    whaleTrades: row.whaleTrades,
    createdAt: db.createdAt,
    graduatedAt: db.graduatedAt,
  };
  return {
    ...base,
    status: tokenStatus(base),
    performance: performanceScore(base),
  };
}

/** Deterministic display order: active → trending → near graduation → graduated → old. */
const STATUS_ORDER: Record<CreatorTokenStatus, number> = {
  active: 0,
  near_graduation: 1,
  graduated: 2,
  idle: 3,
};

export function sortCreatorTokens(tokens: CreatorTokenRow[]): CreatorTokenRow[] {
  return [...tokens].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.trendingScore - a.trendingScore ||
      b.performance - a.performance ||
      a.symbol.localeCompare(b.symbol),
  );
}

export function pickBestPerformer(tokens: CreatorTokenRow[]): CreatorTokenRow | null {
  if (!tokens.length) return null;
  return [...tokens].sort((a, b) => b.performance - a.performance || b.trendingScore - a.trendingScore)[0]!;
}

const minIso = (a: string | null, b: string | null) =>
  a && b ? (a < b ? a : b) : (a ?? b);
const maxIso = (a: string | null, b: string | null) =>
  a && b ? (a > b ? a : b) : (a ?? b);

export function aggregateStats(
  tokens: CreatorTokenRow[],
  histories: Map<string, TokenTrendingHistory>,
): CreatorStats {
  let volume24h = 0;
  let organicVolume = 0;
  let trades = 0;
  let buyers = 0;
  let sellers = 0;
  let whaleTrades = 0;
  let holders: number | null = null;
  let bestRank: number | null = null;
  let top5 = 0;
  let top10 = 0;
  let rising = 0;
  let firstLaunchAt: string | null = null;
  let lastLaunchAt: string | null = null;
  const progresses: number[] = [];

  for (const t of tokens) {
    volume24h += t.volume24h;
    organicVolume += t.volume24h * (t.organicScore / 100);
    trades += t.trades24h;
    buyers += t.buyers;
    sellers += t.sellers;
    whaleTrades += t.whaleTrades;
    if (t.holders != null) holders = (holders ?? 0) + t.holders;
    if (t.bondingProgress != null) progresses.push(t.bondingProgress);
    if (t.bestTrendingRank != null) bestRank = bestRank == null ? t.bestTrendingRank : Math.min(bestRank, t.bestTrendingRank);
    const h = histories.get(t.address.toLowerCase()) ?? EMPTY_HISTORY;
    top5 += h.top5;
    top10 += h.top10;
    rising += h.risingFast;
    firstLaunchAt = minIso(firstLaunchAt, t.createdAt);
    lastLaunchAt = maxIso(lastLaunchAt, t.createdAt);
  }

  const graduated = tokens.filter((t) => t.graduated).length;
  const active = tokens.filter((t) => t.status === "active" || t.status === "near_graduation").length;
  const idle = tokens.filter((t) => t.status === "idle").length;

  return {
    tokensCreated: tokens.length,
    activeTokens: active,
    graduatedTokens: graduated,
    idleTokens: idle,
    bondingTokens: tokens.filter((t) => !t.graduated && t.bondingProgress != null).length,
    avgBondingProgress: progresses.length ? progresses.reduce((a, b) => a + b, 0) / progresses.length : null,
    maxBondingProgress: progresses.length ? Math.max(...progresses) : null,
    volume24h,
    volumeTotalWindowed: volume24h,
    organicVolume24h: organicVolume,
    trades24h: trades,
    uniqueBuyers: buyers,
    uniqueSellers: sellers,
    holders,
    holdersGrowth: null,
    bestTrendingRank: bestRank,
    top5Count: top5,
    top10Count: top10,
    risingCount: rising,
    whaleTrades,
    firstLaunchAt,
    lastLaunchAt,
  };
}

/**
 * 🔥 Creator Score (0..100).
 *
 *   Launch Quality        20%  active-token ratio + saturating launch count
 *   Organic Activity      25%  volume-weighted Organic Activity Score
 *   Community Growth      20%  unique buyers + holders per token
 *   Bonding Performance   20%  graduations + average bonding progress
 *   Trending Performance  15%  best rank + Top 5 + Rising Fast appearances
 *
 * Components without real data are `null` and their weight is redistributed.
 * Launching many empty tokens LOWERS the score (active ratio + per-token
 * normalisation), and absolute volume never dominates (saturating curves).
 */
export function computeCreatorScore(
  stats: CreatorStats,
  tokens: CreatorTokenRow[],
): { score: number; parts: CreatorScoreParts } {
  const n = tokens.length;

  const parts: CreatorScoreParts = {
    launchQuality: null,
    organicActivity: null,
    communityGrowth: null,
    bondingPerformance: null,
    trendingPerformance: null,
  };

  if (n > 0) {
    const activeRatio = stats.activeTokens / n + (stats.graduatedTokens > 0 ? stats.graduatedTokens / n : 0);
    parts.launchQuality = Math.round(
      100 * clamp01(0.6 * clamp01(activeRatio) + 0.4 * sat(stats.activeTokens + stats.graduatedTokens, 2)),
    );
  }

  const traded = tokens.filter((t) => t.trades24h > 0);
  if (traded.length) {
    const totalVol = traded.reduce((a, t) => a + t.volume24h, 0);
    const weighted =
      totalVol > 0
        ? traded.reduce((a, t) => a + t.organicScore * (t.volume24h / totalVol), 0)
        : traded.reduce((a, t) => a + t.organicScore, 0) / traded.length;
    // Reputation from organic activity requires actual reach, not one wallet.
    parts.organicActivity = Math.round(clamp01(weighted / 100) * 100 * (0.5 + 0.5 * sat(stats.uniqueBuyers, 8)));
  }

  const hasHolders = tokens.some((t) => t.holders != null);
  if (hasHolders || stats.uniqueBuyers > 0) {
    const buyersPerToken = n > 0 ? stats.uniqueBuyers / n : 0;
    const holdersPerToken = hasHolders && n > 0 ? (stats.holders ?? 0) / n : null;
    const buyerPart = sat(buyersPerToken, 5);
    const holderPart = holdersPerToken == null ? null : sat(Math.max(0, holdersPerToken - 1), 20);
    const value = holderPart == null ? buyerPart : 0.5 * buyerPart + 0.5 * holderPart;
    parts.communityGrowth = Math.round(100 * clamp01(value));
  }

  if (stats.avgBondingProgress != null || stats.graduatedTokens > 0) {
    const graduationRatio = n > 0 ? stats.graduatedTokens / n : 0;
    const value =
      0.45 * sat(stats.graduatedTokens, 1) +
      0.3 * clamp01(graduationRatio) +
      0.25 * clamp01((stats.maxBondingProgress ?? stats.avgBondingProgress ?? 0) / 100);
    parts.bondingPerformance = Math.round(100 * clamp01(value));
  }

  if (stats.bestTrendingRank != null || stats.top10Count > 0 || stats.risingCount > 0) {
    const rankScore = stats.bestTrendingRank == null ? 0 : clamp01((11 - stats.bestTrendingRank) / 10);
    const value = 0.5 * rankScore + 0.3 * sat(stats.top5Count, 2) + 0.2 * sat(stats.risingCount, 2);
    parts.trendingPerformance = Math.round(100 * clamp01(value));
  }

  let weightSum = 0;
  let acc = 0;
  for (const key of Object.keys(CREATOR_WEIGHTS) as (keyof typeof CREATOR_WEIGHTS)[]) {
    const value = parts[key];
    if (value == null) continue;
    weightSum += CREATOR_WEIGHTS[key];
    acc += value * CREATOR_WEIGHTS[key];
  }
  const score = weightSum > 0 ? Math.round(acc / weightSum) : 0;
  return { score: Math.max(0, Math.min(100, score)), parts };
}

export function computeCreatorBadges(
  stats: CreatorStats,
  tokens: CreatorTokenRow[],
  now = Date.now(),
): CreatorBadge[] {
  const badges: CreatorBadge[] = [];
  const first = stats.firstLaunchAt ? Date.parse(stats.firstLaunchAt) : null;
  const recent = first != null && now - first < 30 * 86_400_000;
  if (stats.tokensCreated > 0 && stats.tokensCreated <= 2 && (recent || first == null)) badges.push("new_creator");
  if (stats.bestTrendingRank != null && stats.bestTrendingRank <= 5) badges.push("trending_creator");
  if (stats.risingCount > 0 || tokens.some((t) => (t.velocityScore ?? 0) >= 50)) badges.push("rising_creator");
  if (tokens.some((t) => (t.bondingProgress ?? 0) >= 80)) badges.push("near_graduation");
  if (stats.graduatedTokens >= 1) badges.push("graduator");
  if (stats.graduatedTokens >= 2) badges.push("multi_graduator");
  if (stats.whaleTrades >= 3) badges.push("whale_magnet");
  if ((stats.holders ?? 0) >= 50 || stats.uniqueBuyers >= 25) badges.push("community_builder");
  return badges;
}

/** Real timeline: token creations (DB) + trending/bonding events (snapshots). */
export function buildTimeline(
  tokens: CreatorTokenRow[],
  histories: Map<string, TokenTrendingHistory>,
  limit = 40,
): CreatorEvent[] {
  const events: CreatorEvent[] = [];
  for (const t of tokens) {
    if (t.createdAt) {
      events.push({ kind: "token_created", at: t.createdAt, token: t.address, symbol: t.symbol, detail: t.name });
    }
    if (t.graduatedAt) {
      events.push({ kind: "graduation", at: t.graduatedAt, token: t.address, symbol: t.symbol, detail: null });
    }
    const h = histories.get(t.address.toLowerCase());
    if (h) events.push(...h.events);
  }
  return events
    .filter((e) => Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}
