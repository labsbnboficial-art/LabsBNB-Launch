// LabsBNB Trending Engine — shared types + configuration contract.
//
// Every metric in this module is derived from REAL on-chain data (decoded
// `Trade(...)` logs + BondingCurve views). `null` always means "not available"
// and the UI must render it as such — never a fabricated number.

export const TREND_WINDOWS = ["5m", "15m", "1h", "6h", "24h"] as const;
export type WindowId = (typeof TREND_WINDOWS)[number];

export const WINDOW_SECONDS: Record<WindowId, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "6h": 21_600,
  "24h": 86_400,
};

export const TRENDING_CATEGORIES = ["trending", "rising", "volume", "graduation"] as const;
export type TrendingCategory = (typeof TRENDING_CATEGORIES)[number];

export const TRENDING_STAGES = ["all", "bonding", "near_graduation", "graduated"] as const;
export type TrendingStage = (typeof TRENDING_STAGES)[number];

export type TrendingWeights = {
  momentum: number;
  buyers: number;
  holders: number;
  bonding: number;
  whales: number;
  activity: number;
};

export type TrendingConfig = {
  engine_enabled: boolean;
  /** Minutes between automated runs (informational for the cron caller). */
  scan_interval_min: number;
  /** How many tokens the factory listing is scanned for on each run. */
  scan_tokens: number;
  weights: TrendingWeights;
  /** Tokens below this trade count in 24h are excluded from the ranking. */
  min_trades_24h: number;
  /** % acceleration required for the ⚡ Rising Fast badge. */
  velocity_threshold: number;
  /** Bonding progress (%) required for the 🎯 Near Graduation badge. */
  near_graduation_pct: number;
  /** BNB size of a single trade to count as whale activity. */
  whale_bnb: number;
};

export const DEFAULT_TRENDING_WEIGHTS: TrendingWeights = {
  momentum: 30,
  buyers: 20,
  holders: 15,
  bonding: 15,
  whales: 10,
  activity: 10,
};

export const DEFAULT_TRENDING_CONFIG: TrendingConfig = {
  engine_enabled: true,
  scan_interval_min: 3,
  scan_tokens: 24,
  weights: DEFAULT_TRENDING_WEIGHTS,
  min_trades_24h: 0,
  velocity_threshold: 50,
  near_graduation_pct: 80,
  whale_bnb: 0.5,
};

export type WindowStats = {
  volume: number; // BNB
  trades: number;
  buys: number;
  sells: number;
  buyers: number; // unique buyer wallets
  sellers: number; // unique seller wallets
  traders: number; // unique wallets (buy or sell)
  /** Share (0..1) of the window volume executed by its single largest wallet. */
  topTraderShare: number;
  /** Share (0..1) of volume from wallets that both bought and sold (wash-like). */
  roundTripShare: number;
  whaleTrades: number;
  whaleVolume: number;
};

export type TrendingMetrics = {
  windows: Record<WindowId, WindowStats>;
  /** % acceleration of the 15m trade rate vs the previous 45 minutes. */
  velocityPct: number | null;
  holders: number | null;
  holdersGrowth: number | null; // absolute new holders since the previous snapshot
  bondingProgress: number | null; // 0..100
  lastTradeAt: number | null; // unix seconds
  organicScore: number; // 0..100
};

export type TrendingBadge =
  | "trending"
  | "rising_fast"
  | "near_graduation"
  | "graduation_soon"
  | "whale_activity"
  | "volume_spike";

export const BADGE_LABEL: Record<TrendingBadge, string> = {
  trending: "🔥 Trending",
  rising_fast: "⚡ Rising Fast",
  near_graduation: "🎯 Near Graduation",
  graduation_soon: "🚀 Graduation Soon",
  whale_activity: "🐋 Whale Activity",
  volume_spike: "📈 Volume Spike",
};

export type TrendingScoreParts = {
  momentum: number | null;
  buyers: number | null;
  holders: number | null;
  bonding: number | null;
  whales: number | null;
  activity: number | null;
};

/** One ranked token as served by the API / server function. */
export type TrendingRow = {
  address: string;
  curve: string | null;
  name: string;
  symbol: string;
  logo: string | null;
  price: string | null; // BNB per token
  priceChange24h: number | null;
  volume: number; // volume of the requested timeframe (BNB)
  volumes: Record<WindowId, number>;
  trades: number;
  buyers: number;
  sellers: number;
  holders: number | null;
  bondingProgress: number | null;
  bondingRemaining: string | null;
  graduated: boolean;
  trendingScore: number;
  velocityScore: number | null;
  organicScore: number;
  whaleTrades: number;
  parts: TrendingScoreParts;
  badges: TrendingBadge[];
  reason: string;
  lastTradeAt: string | null;
  rank: number;
  updatedAt: string;
};

export type TrendingEngineState = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastTrigger: string | null;
  tokensScanned: number;
  tokensRanked: number;
  tokensExcluded: number;
  durationMs: number;
  errors: number;
  lastError: string | null;
  notes: string[];
};

export const EMPTY_TRENDING_STATE: TrendingEngineState = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastTrigger: null,
  tokensScanned: 0,
  tokensRanked: 0,
  tokensExcluded: 0,
  durationMs: 0,
  errors: 0,
  lastError: null,
  notes: [],
};
