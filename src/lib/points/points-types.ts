// 🏆 LabsBNB Creator Points — shared types + configuration contract (Fase 2B).
//
// Creator Points are INTERNAL reputation points:
//   • they are not BNB, not a token, not a currency
//   • they cannot be withdrawn, transferred or traded
//   • they never touch on-chain balances or execute transactions
//
// Every point is derived from REAL on-chain activity (Factory `creatorOf`,
// decoded `Trade(...)` logs, BondingCurve views, `trending_snapshots`).
// When a metric is unavailable the event is simply NOT awarded — never faked.

export const POINTS_EVENT_TYPES = [
  "TOKEN_CREATED",
  "UNIQUE_BUYER_MILESTONE",
  "HOLDER_MILESTONE",
  "ORGANIC_VOLUME_MILESTONE",
  "TRENDING_TOP10",
  "TRENDING_TOP5",
  "RISING_FAST",
  "NEAR_GRADUATION",
  "GRADUATED",
  "COMMUNITY_MILESTONE",
  "ADMIN_ADJUSTMENT",
] as const;

export type PointsEventType = (typeof POINTS_EVENT_TYPES)[number];

export const POINTS_EVENT_LABEL: Record<PointsEventType, string> = {
  TOKEN_CREATED: "🪙 Token creado",
  UNIQUE_BUYER_MILESTONE: "👥 Compradores únicos",
  HOLDER_MILESTONE: "💎 Holders",
  ORGANIC_VOLUME_MILESTONE: "📈 Volumen orgánico",
  TRENDING_TOP10: "🔥 Trending Top 10",
  TRENDING_TOP5: "🔥 Trending Top 5",
  RISING_FAST: "⚡ Rising Fast",
  NEAR_GRADUATION: "🎯 Near Graduation",
  GRADUATED: "🚀 Graduated",
  COMMUNITY_MILESTONE: "🤝 Community milestone",
  ADMIN_ADJUSTMENT: "🛠️ Ajuste administrativo",
};

/** Per-event, admin-configurable rules. Validated server-side before storage. */
export type PointsEventConfig = {
  enabled: boolean;
  /** Points for single-shot events. Milestone events use `milestone_points`. */
  base_points: number;
  /** Max points this event can award to one token in a UTC day (0 = no cap). */
  daily_cap: number;
  /** True when the event can only ever be awarded once per token. */
  one_time: boolean;
  /** Whether the Organic Activity multiplier is applied to the base points. */
  apply_multiplier: boolean;
  /** Minimum real trades (24h window scanned) required to award the event. */
  minimum_activity: number;
};

export type CreatorPointsConfig = {
  engine_enabled: boolean;
  /** Minutes between automated runs (informational for the cron caller). */
  scan_interval_min: number;
  /** Rewarded token creations per creator per 24h (anti token-spam). */
  max_token_creations_per_day: number;
  /** Days of `Trade(...)` history scanned per token on each run. */
  lookback_days: number;
  /** Unique buyer thresholds (ascending). */
  buyer_milestones: number[];
  /** Holder thresholds (ascending). */
  holder_milestones: number[];
  /** Organic volume thresholds in BNB (ascending). */
  volume_milestones: number[];
  /** Points paid per milestone tier (parallel to the three arrays above). */
  milestone_points: number[];
  /** Community milestone requirements (real data only). */
  community_min_holders: number;
  community_min_buyers: number;
  events: Record<PointsEventType, PointsEventConfig>;
};

const single = (
  base: number,
  extra: Partial<PointsEventConfig> = {},
): PointsEventConfig => ({
  enabled: true,
  base_points: base,
  daily_cap: 0,
  one_time: true,
  apply_multiplier: false,
  minimum_activity: 0,
  ...extra,
});

export const DEFAULT_MILESTONE_POINTS = [100, 250, 500, 1000, 2500, 5000, 10_000];

export const DEFAULT_POINTS_CONFIG: CreatorPointsConfig = {
  engine_enabled: true,
  scan_interval_min: 5,
  max_token_creations_per_day: 3,
  lookback_days: 7,
  buyer_milestones: [5, 10, 25, 50, 100, 250, 500],
  holder_milestones: [5, 10, 25, 50, 100, 250, 500],
  volume_milestones: [5, 10, 25, 50, 100, 250, 500],
  milestone_points: [...DEFAULT_MILESTONE_POINTS],
  community_min_holders: 50,
  community_min_buyers: 25,
  events: {
    TOKEN_CREATED: single(100, { one_time: true }),
    UNIQUE_BUYER_MILESTONE: single(0, {
      one_time: true,
      apply_multiplier: true,
      daily_cap: 10_000,
      minimum_activity: 1,
    }),
    HOLDER_MILESTONE: single(0, { one_time: true, apply_multiplier: true, daily_cap: 10_000 }),
    ORGANIC_VOLUME_MILESTONE: single(0, {
      one_time: true,
      apply_multiplier: true,
      daily_cap: 10_000,
      minimum_activity: 1,
    }),
    TRENDING_TOP10: single(250),
    TRENDING_TOP5: single(1_000),
    RISING_FAST: single(500),
    NEAR_GRADUATION: single(1_000),
    GRADUATED: single(5_000),
    COMMUNITY_MILESTONE: single(2_000, { apply_multiplier: true }),
    ADMIN_ADJUSTMENT: single(0, { enabled: false, one_time: false }),
  },
};

/** One row of the append-only ledger, as read back by the app. */
/** JSON-serialisable metadata (crosses the RPC boundary). */
export type PointsMetadata = Record<string, string | number | boolean | null>;

export type PointsLedgerEntry = {
  id: string;
  creatorAddress: string;
  chainId: number;
  eventType: PointsEventType;
  sourceId: string | null;
  sourceRef: string | null;
  tokenAddress: string | null;
  points: number;
  basePoints: number;
  multiplier: number;
  reason: string | null;
  metadata: PointsMetadata | null;
  fingerprint: string;
  createdAt: string;
};

/** A candidate produced by the engine before persistence. */
export type PointsCandidate = {
  creatorAddress: string;
  chainId: number;
  eventType: PointsEventType;
  sourceId: string;
  sourceRef: string | null;
  tokenAddress: string | null;
  basePoints: number;
  multiplier: number;
  points: number;
  reason: string;
  metadata: PointsMetadata;
  fingerprint: string;
};

export type PointsExclusion = {
  eventType: PointsEventType;
  tokenAddress: string | null;
  creatorAddress: string;
  reason: string;
};

export type PointsEngineState = {
  runId: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastTrigger: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  creatorsScanned: number;
  tokensScanned: number;
  eventsScanned: number;
  eventsEligible: number;
  pointsAwarded: number;
  duplicatesSkipped: number;
  antiFarmingExcluded: number;
  errors: number;
  lastError: string | null;
  durationMs: number;
  notes: string[];
};

export const EMPTY_POINTS_STATE: PointsEngineState = {
  runId: null,
  lastRunAt: null,
  lastSuccessAt: null,
  lastTrigger: null,
  startedAt: null,
  finishedAt: null,
  creatorsScanned: 0,
  tokensScanned: 0,
  eventsScanned: 0,
  eventsEligible: 0,
  pointsAwarded: 0,
  duplicatesSkipped: 0,
  antiFarmingExcluded: 0,
  errors: 0,
  lastError: null,
  durationMs: 0,
  notes: [],
};

export type PointsRunResult = {
  ok: boolean;
  dryRun: boolean;
  skipped?: "disabled" | "locked" | "storage";
  state: PointsEngineState;
  candidates: PointsCandidate[];
  exclusions: PointsExclusion[];
};

export type CreatorPointsSummary = {
  address: string;
  chainId: number;
  totalPoints: number;
  pointsToday: number;
  pointsThisMonth: number;
  events: number;
  lastEventAt: string | null;
  /** Leaderboard position — `null` until Fase 2E ships (never invented). */
  rank: number | null;
};
