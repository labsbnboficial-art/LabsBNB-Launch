// 🏆 Fase 2E — Creator Leaderboard + Seasons: shared types.
//
// The Leaderboard NEVER creates points, scores or achievements: it only READS
// the existing engines (Creator Points ledger, Creator Score, Levels,
// Achievements, Trending snapshots) and produces a *ranking* on top of them.
//
// `null` always means "unavailable" (unknown) and is NEVER rendered as 0.

export const LEADERBOARD_METRICS = ["points", "score", "graduations", "trending", "organic"] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export type MetricWeights = Record<LeaderboardMetric, number>;

/** Overall Leaderboard Score default weights (sum = 100). */
export const DEFAULT_LEADERBOARD_WEIGHTS: MetricWeights = {
  points: 40,
  score: 25,
  graduations: 15,
  trending: 10,
  organic: 10,
};

export const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  points: "Creator Points",
  score: "Creator Score",
  graduations: "Graduations",
  trending: "Trending Performance",
  organic: "Organic Activity",
};

export const LEADERBOARD_CATEGORIES = [
  "overall",
  "points",
  "score",
  "graduators",
  "trending",
  "rising",
  "whale",
  "community",
] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<LeaderboardCategory, string> = {
  overall: "🏆 Overall",
  points: "⭐ Points",
  score: "🔥 Creator Score",
  graduators: "🚀 Graduators",
  trending: "📈 Trending",
  rising: "⚡ Rising",
  whale: "🐋 Whale Magnet",
  community: "💎 Community",
};

/** Raw (un-normalized) metric values of one creator. `null` = unavailable. */
export type RawMetrics = {
  points: number | null;
  score: number | null;
  graduations: number | null;
  trending: number | null;
  organic: number | null;
};

export type CreatorLevelBrief = {
  level: number;
  name: string;
  icon: string;
};

export type AchievementBadgeBrief = { key: string; icon: string; name: string; rarity: string };

/** One creator as evaluated by the Leaderboard Engine (pre-ranking). */
export type LeaderboardCandidate = {
  address: string; // lowercase canonical
  displayName: string | null;
  avatarUrl: string | null;
  level: CreatorLevelBrief | null;
  raw: RawMetrics;
  /** Secondary metrics used only by category tabs (never by Overall). */
  extras: {
    tokensCreated: number;
    uniqueBuyers: number | null;
    holders: number | null;
    whaleTrades: number | null;
    risingCount: number | null;
    top5: number | null;
    top10: number | null;
    bestTrendingRank: number | null;
    organicVolume24h: number | null;
  };
  achievementBadges: AchievementBadgeBrief[];
};

/** A ranked row, ready for the API/UI. */
export type LeaderboardEntry = LeaderboardCandidate & {
  rank: number;
  overallScore: number;
  /** 0–100 normalized components actually used, `null` where unavailable. */
  components: Record<LeaderboardMetric, number | null>;
  /** Metrics whose weight was redistributed because the data is unavailable. */
  missingMetrics: LeaderboardMetric[];
  previousRank: number | null;
  rankChange: number | null; // positive = climbed
  isNew: boolean;
  bestRank: number | null;
};

export type LeaderboardPage = {
  entries: LeaderboardEntry[];
  top3: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  category: LeaderboardCategory;
  chainId: number;
  /** Metrics unavailable for the whole run (weight redistributed globally). */
  unavailableMetrics: LeaderboardMetric[];
  updating: boolean;
  updatedAt: string;
  source: string;
};

/* ---------------------------------- seasons -------------------------------- */

export const SEASON_STATUSES = ["draft", "scheduled", "active", "ended", "archived"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export type SeasonRules = {
  pointsEnabled: boolean;
  scoreEnabled: boolean;
  graduationsEnabled: boolean;
  trendingEnabled: boolean;
  organicEnabled: boolean;
  weights: MetricWeights;
};

export const DEFAULT_SEASON_RULES: SeasonRules = {
  pointsEnabled: true,
  scoreEnabled: true,
  graduationsEnabled: true,
  trendingEnabled: true,
  organicEnabled: true,
  weights: { ...DEFAULT_LEADERBOARD_WEIGHTS },
};

export type CreatorSeason = {
  id: string;
  chainId: number;
  name: string;
  slug: string;
  description: string | null;
  status: SeasonStatus;
  startsAt: string;
  endsAt: string;
  rules: SeasonRules;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
};

export type SeasonSummary = CreatorSeason & {
  participants: number;
  top3: { address: string; rank: number; score: number; displayName: string | null }[];
};

/* -------------------------------- snapshots -------------------------------- */

export type LeaderboardSnapshotRow = {
  chainId: number;
  creatorAddress: string;
  rank: number;
  overallScore: number;
  creatorPoints: number | null;
  creatorScore: number | null;
  graduations: number | null;
  trendingMetric: number | null;
  organicMetric: number | null;
  components: Record<string, number | null>;
  snapshotAt: string;
  fingerprint: string;
};

export type SeasonSnapshotRow = LeaderboardSnapshotRow & {
  seasonId: string;
  seasonScore: number;
  isFinal: boolean;
};

/* --------------------------------- engine ---------------------------------- */

export type LeaderboardEngineState = {
  runId: string | null;
  trigger: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  seasonId: string | null;
  creatorsEvaluated: number;
  snapshotsCreated: number;
  seasonSnapshotsCreated: number;
  duplicates: number;
  errors: number;
  lastError: string | null;
  durationMs: number;
  notes: string[];
};

export const EMPTY_LEADERBOARD_STATE: LeaderboardEngineState = {
  runId: null,
  trigger: null,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  seasonId: null,
  creatorsEvaluated: 0,
  snapshotsCreated: 0,
  seasonSnapshotsCreated: 0,
  duplicates: 0,
  errors: 0,
  lastError: null,
  durationMs: 0,
  notes: [],
};

export type LeaderboardRunResult = {
  state: LeaderboardEngineState;
  dryRun: boolean;
  skipped: boolean;
  skippedReason: string | null;
};

/** Leaderboard block rendered inside `/creator/:address`. */
export type CreatorLeaderboardSummary = {
  address: string;
  chainId: number;
  currentRank: number | null;
  previousRank: number | null;
  rankChange: number | null;
  bestRank: number | null;
  worstRank: number | null;
  overallScore: number | null;
  isNew: boolean;
  season: {
    slug: string;
    name: string;
    rank: number | null;
    score: number | null;
    endsAt: string;
  } | null;
  storageReady: boolean;
  storageError: string | null;
};
