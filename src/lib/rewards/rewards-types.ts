// 🎁 Fase 2F — Creator Rewards & Airdrop Eligibility: shared types.
//
// This engine DOES NOT distribute tokens, BNB or money. It only answers:
// "does this creator meet the conditions to be eligible for a future reward?"
// and stores an auditable, append-only record of that answer.
//
// It CREATES nothing: no points, no achievements, no levels, no score.
// Every metric is READ from the existing engines. `null` = unavailable (N/A)
// and is NEVER rendered as 0 nor treated as FAIL.

export const REWARD_PROGRAM_STATUSES = ["draft", "scheduled", "active", "ended", "archived"] as const;
export type RewardProgramStatus = (typeof REWARD_PROGRAM_STATUSES)[number];

export const PROGRAM_STATUS_LABEL: Record<RewardProgramStatus, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  active: "Activo",
  ended: "Finalizado",
  archived: "Archivado",
};

/** §24 — never confuse `pending` (missing data) with `not_eligible` (a real FAIL). */
export const ELIGIBILITY_STATUSES = ["eligible", "not_eligible", "pending", "excluded"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  eligible: "🟢 Eligible",
  not_eligible: "🔴 Not eligible",
  pending: "🟡 Pending",
  excluded: "⛔ Excluded",
};

/** §11 — evaluation windows. */
export const EVALUATION_WINDOWS = ["current", "season", "historical"] as const;
export type EvaluationWindow = (typeof EVALUATION_WINDOWS)[number];

/** §4 — configurable eligibility criteria. */
export const CRITERIA_KEYS = [
  "points",
  "score",
  "level",
  "achievements",
  "graduations",
  "organic",
  "seasonRank",
] as const;
export type CriterionKey = (typeof CRITERIA_KEYS)[number];

export const CRITERION_LABEL: Record<CriterionKey, string> = {
  points: "Creator Points",
  score: "Creator Score",
  level: "Creator Level",
  achievements: "Achievements",
  graduations: "Graduations",
  organic: "Organic Activity",
  seasonRank: "Season Rank",
};

/**
 * One configurable rule.
 *  • `required = true`  → hard requirement: FAIL ⇒ NOT ELIGIBLE (§8)
 *  • `required = false` → soft requirement: only affects the Eligibility Score
 *  • `seasonRank` is the only "lower is better" criterion (`minimum` = max rank)
 */
export type CriterionRule = {
  enabled: boolean;
  minimum: number | null;
  required: boolean;
  weight: number;
};

export type ExclusionRules = {
  selfTradeDetected: boolean;
  circularActivity: boolean;
  nonOrganicActivity: boolean;
  requireSeasonParticipation: boolean;
  /** Admin-only list (never public, never client editable). */
  blockedCreators: string[];
};

export type RewardRules = {
  criteria: Record<CriterionKey, CriterionRule>;
  exclusions: ExclusionRules;
};

export const DEFAULT_REWARD_RULES: RewardRules = {
  criteria: {
    points: { enabled: true, minimum: 500, required: true, weight: 25 },
    score: { enabled: true, minimum: 40, required: true, weight: 20 },
    level: { enabled: true, minimum: 2, required: false, weight: 15 },
    achievements: { enabled: true, minimum: 1, required: false, weight: 10 },
    graduations: { enabled: true, minimum: 0, required: false, weight: 20 },
    organic: { enabled: true, minimum: 50, required: true, weight: 10 },
    seasonRank: { enabled: false, minimum: null, required: false, weight: 0 },
  },
  exclusions: {
    selfTradeDetected: true,
    circularActivity: true,
    nonOrganicActivity: true,
    requireSeasonParticipation: false,
    blockedCreators: [],
  },
};

/* -------------------------------- programs --------------------------------- */

export type RewardProgram = {
  id: string;
  chainId: number;
  name: string;
  slug: string;
  description: string | null;
  status: RewardProgramStatus;
  startsAt: string | null;
  endsAt: string | null;
  seasonId: string | null;
  evaluationWindow: EvaluationWindow;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  ruleVersion: number;
  rules: RewardRules;
  createdAt: string;
  updatedAt: string;
};

/** §23 — immutable rule history. Snapshots always reference one version. */
export type RewardRuleVersion = {
  id: string;
  programId: string;
  version: number;
  rules: RewardRules;
  note: string | null;
  createdAt: string;
};

export type RewardProgramSummary = RewardProgram & {
  seasonSlug: string | null;
  seasonName: string | null;
  evaluatedCreators: number | null;
  eligibleCreators: number | null;
  lastEvaluatedAt: string | null;
};

/* ------------------------------- evaluation -------------------------------- */

export type CriterionStatus = "pass" | "fail" | "na";

export type CriterionResult = {
  key: CriterionKey;
  label: string;
  status: CriterionStatus;
  required: boolean;
  /** Real measured value; `null` = unavailable (never rendered as 0). */
  value: number | null;
  target: number | null;
  /** 0–1 completion of this criterion; `null` when unavailable. */
  progress: number | null;
  weight: number;
};

export type EligibilityMetrics = {
  points: number | null;
  score: number | null;
  level: number | null;
  levelName: string | null;
  achievements: number | null;
  graduations: number | null;
  organic: number | null;
  seasonRank: number | null;
};

export const EMPTY_METRICS: EligibilityMetrics = {
  points: null,
  score: null,
  level: null,
  levelName: null,
  achievements: null,
  graduations: null,
  organic: null,
  seasonRank: null,
};

export type RiskFlag = "self_trade_detected" | "circular_activity" | "non_organic_activity" | "blacklisted_creator";

export type EligibilityEvaluation = {
  address: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: EligibilityStatus;
  /** §7 — internal progress metric. NEVER a token amount, NEVER a Creator Score. */
  eligibilityScore: number;
  criteria: CriterionResult[];
  metrics: EligibilityMetrics;
  riskFlags: RiskFlag[];
  exclusionReasons: string[];
  missingCriteria: CriterionKey[];
};

export type EligibilityPage = {
  program: RewardProgramSummary | null;
  entries: (EligibilityEvaluation & { rank: number })[];
  total: number;
  page: number;
  pageSize: number;
  filter: EligibilityStatus | "all";
  counts: Record<EligibilityStatus, number>;
  chainId: number;
  evaluatedAt: string;
  updating: boolean;
  storageReady: boolean;
  storageError: string | null;
};

/* -------------------------------- snapshots -------------------------------- */

export type EligibilitySnapshotRow = {
  chainId: number;
  programId: string;
  ruleVersion: number;
  creatorAddress: string;
  status: EligibilityStatus;
  eligible: boolean;
  eligibilityScore: number;
  points: number | null;
  creatorScore: number | null;
  creatorLevel: number | null;
  achievements: number | null;
  graduations: number | null;
  organicScore: number | null;
  seasonRank: number | null;
  criteriaResult: unknown;
  riskFlags: string[];
  evaluationWindow: EvaluationWindow;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  evaluatedAt: string;
  fingerprint: string;
};

/* --------------------------------- engine ---------------------------------- */

export type RewardsEngineState = {
  runId: string | null;
  trigger: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  programsEvaluated: number;
  creatorsEvaluated: number;
  eligible: number;
  notEligible: number;
  pending: number;
  excluded: number;
  snapshotsCreated: number;
  duplicates: number;
  errors: number;
  lastError: string | null;
  durationMs: number;
  notes: string[];
};

export const EMPTY_REWARDS_STATE: RewardsEngineState = {
  runId: null,
  trigger: null,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  programsEvaluated: 0,
  creatorsEvaluated: 0,
  eligible: 0,
  notEligible: 0,
  pending: 0,
  excluded: 0,
  snapshotsCreated: 0,
  duplicates: 0,
  errors: 0,
  lastError: null,
  durationMs: 0,
  notes: [],
};

export type RewardsRunResult = {
  state: RewardsEngineState;
  dryRun: boolean;
  skipped: boolean;
  skippedReason: string | null;
};

/** 🎁 Rewards block rendered inside `/creator/:address`. */
export type CreatorRewardsSummary = {
  address: string;
  chainId: number;
  programs: {
    slug: string;
    name: string;
    status: RewardProgramStatus;
    seasonName: string | null;
    endsAt: string | null;
    evaluation: EligibilityEvaluation;
    snapshotAt: string | null;
    ruleVersion: number;
  }[];
  storageReady: boolean;
  storageError: string | null;
};
