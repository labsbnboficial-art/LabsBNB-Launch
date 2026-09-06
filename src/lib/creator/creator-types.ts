// LabsBNB Creator System — Fase 2A (profiles + reputation).
//
// Every value here is DERIVED from real data: Factory `creatorOf`, decoded
// on-chain `Trade(...)` logs (through the Trending Engine) and the stored
// `trending_snapshots` history. `null` always means "not available on-chain"
// and must render as "N/A" — never as a fabricated number.

export type CreatorTokenStatus = "graduated" | "near_graduation" | "active" | "idle";

/** One token of a creator, already enriched with real Trending Engine metrics. */
export type CreatorTokenRow = {
  address: string;
  name: string;
  symbol: string;
  logo: string | null;
  price: string | null;
  priceChange24h: number | null;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  buyers: number;
  sellers: number;
  holders: number | null;
  bondingProgress: number | null;
  graduated: boolean;
  trendingScore: number;
  trendingRank: number | null;
  bestTrendingRank: number | null;
  velocityScore: number | null;
  organicScore: number;
  whaleTrades: number;
  status: CreatorTokenStatus;
  createdAt: string | null;
  graduatedAt: string | null;
  /** Objective performance metric used to pick the Best Performer. */
  performance: number;
};

/** Historical trending facts of one token, read from `trending_snapshots`. */
export type TokenTrendingHistory = {
  bestRank: number | null;
  top5: number;
  top10: number;
  risingFast: number;
  reachedNearGraduation: boolean;
  bestScore: number | null;
  firstSeenAt: string | null;
  events: CreatorEvent[];
};

export const EMPTY_HISTORY: TokenTrendingHistory = {
  bestRank: null,
  top5: 0,
  top10: 0,
  risingFast: 0,
  reachedNearGraduation: false,
  bestScore: null,
  firstSeenAt: null,
  events: [],
};

export type CreatorEventKind =
  | "token_created"
  | "trending_top10"
  | "trending_top5"
  | "rising_fast"
  | "near_graduation"
  | "graduation"
  | "whale_activity";

export type CreatorEvent = {
  kind: CreatorEventKind;
  at: string; // ISO
  token: string; // address
  symbol: string;
  detail: string | null;
};

export const EVENT_LABEL: Record<CreatorEventKind, string> = {
  token_created: "🪙 Token created",
  trending_top10: "📈 Trending Top 10",
  trending_top5: "🔥 Trending Top 5",
  rising_fast: "⚡ Rising Fast",
  near_graduation: "🎯 Near Graduation",
  graduation: "🚀 Graduated",
  whale_activity: "🐋 Whale activity",
};

export type CreatorBadge =
  | "new_creator"
  | "trending_creator"
  | "rising_creator"
  | "near_graduation"
  | "graduator"
  | "multi_graduator"
  | "whale_magnet"
  | "community_builder";

export const CREATOR_BADGE_LABEL: Record<CreatorBadge, string> = {
  new_creator: "🆕 New Creator",
  trending_creator: "🔥 Trending Creator",
  rising_creator: "⚡ Rising Creator",
  near_graduation: "🎯 Near Graduation",
  graduator: "🚀 Graduator",
  multi_graduator: "🏆 Multi Graduator",
  whale_magnet: "🐋 Whale Magnet",
  community_builder: "💎 Community Builder",
};

export type CreatorScoreParts = {
  launchQuality: number | null;
  organicActivity: number | null;
  communityGrowth: number | null;
  bondingPerformance: number | null;
  trendingPerformance: number | null;
};

export const CREATOR_WEIGHTS = {
  launchQuality: 20,
  organicActivity: 25,
  communityGrowth: 20,
  bondingPerformance: 20,
  trendingPerformance: 15,
} as const;

export type CreatorWeights = typeof CREATOR_WEIGHTS;

export type CreatorStats = {
  tokensCreated: number;
  activeTokens: number;
  graduatedTokens: number;
  idleTokens: number;
  bondingTokens: number;
  avgBondingProgress: number | null;
  maxBondingProgress: number | null;
  volume24h: number;
  volumeTotalWindowed: number; // sum of the 24h windows currently measurable
  organicVolume24h: number;
  trades24h: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  holders: number | null;
  holdersGrowth: number | null;
  bestTrendingRank: number | null;
  top5Count: number;
  top10Count: number;
  risingCount: number;
  whaleTrades: number;
  firstLaunchAt: string | null;
  lastLaunchAt: string | null;
};

/** Editable, sanitised, optional profile customisation (never affects score). */
export type CreatorCustomization = {
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

export const EMPTY_CUSTOMIZATION: CreatorCustomization = {
  displayName: null,
  avatarUrl: null,
  bio: null,
  twitter: null,
  telegram: null,
  website: null,
};

export type CreatorProfile = {
  address: string; // lowercase, canonical identity
  chainId: number;
  score: number;
  parts: CreatorScoreParts;
  badges: CreatorBadge[];
  stats: CreatorStats;
  tokens: CreatorTokenRow[];
  bestPerformer: CreatorTokenRow | null;
  timeline: CreatorEvent[];
  customization: CreatorCustomization;
  updatedAt: string;
};

export type CreatorLevelSummary = {
  level: number;
  name: string;
  icon: string;
  progressPercent: number;
  pointsToNextLevel: number;
  nextLevelName: string | null;
};

export type CreatorLeaderboardRow = {
  address: string;
  displayName: string | null;
  avatarUrl: string | null;
  score: number;
  tokensCreated: number;
  graduatedTokens: number;
  organicVolume24h: number;
  bestTrendingRank: number | null;
  badges: CreatorBadge[];
  rank: number;
  /** Accumulated Creator Points (SUM of the ledger). Never confused with score. */
  creatorPoints: number;
  /** Derived progression. `null` when Creator Levels are disabled by admin. */
  creatorLevel: CreatorLevelSummary | null;
  /** Compact unlocked achievements (Fase 2D). Batched: never one query per row. */
  achievementBadges: { key: string; icon: string; name: string; rarity: string }[];
};

