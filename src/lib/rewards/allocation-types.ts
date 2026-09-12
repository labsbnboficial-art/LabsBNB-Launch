// 🎁 Fase 2G — Reward Allocation Engine: shared types.
//
// "Eligibility → Allocation". This layer computes HOW MUCH relative weight each
// ELIGIBLE creator would receive inside a program. It is an internal, auditable
// calculation:
//   • no token transfer      • no transaction      • no claim / Merkle
//   • no contract call       • no promise of any amount, token or date
//
// Every metric is READ from the eligibility snapshots produced by Fase 2F.
// `null` = unavailable (N/A) and is NEVER rendered as 0 nor treated as 0.
import type { EligibilityStatus } from "./rewards-types";

export const ALLOCATION_METHODS = ["weighted", "equal"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export const ALLOCATION_METHOD_LABEL: Record<AllocationMethod, string> = {
  weighted: "Ponderado por métricas",
  equal: "Reparto igualitario",
};

/** Factors available to the weighted method. All of them come from real data. */
export const ALLOCATION_FACTOR_KEYS = [
  "eligibilityScore",
  "points",
  "score",
  "level",
  "achievements",
  "graduations",
  "organic",
  "seasonRank",
] as const;
export type AllocationFactorKey = (typeof ALLOCATION_FACTOR_KEYS)[number];

export const ALLOCATION_FACTOR_LABEL: Record<AllocationFactorKey, string> = {
  eligibilityScore: "Eligibility Score",
  points: "Creator Points",
  score: "Creator Score",
  level: "Creator Level",
  achievements: "Achievements",
  graduations: "Graduations",
  organic: "Organic Activity",
  seasonRank: "Season Rank",
};

export type AllocationFactor = { enabled: boolean; weight: number };

/**
 * Optional reward pool. When `enabled` and `total > 0` the engine also computes
 * an INTERNAL `allocationAmount = total × pct`. It is a calculation of the
 * program, never a transfer nor a commitment.
 */
export type AllocationPool = { enabled: boolean; total: number | null; unit: string | null };

/**
 * What `/rewards` may show:
 *  • hidden  → nothing about allocation is public
 *  • weights → percentages / normalized weights only (never amounts)
 *  • amounts → percentages AND the internal amounts (requires a configured pool)
 */
export const ALLOCATION_VISIBILITIES = ["hidden", "weights", "amounts"] as const;
export type AllocationVisibility = (typeof ALLOCATION_VISIBILITIES)[number];

export type AllocationConfig = {
  enabled: boolean;
  method: AllocationMethod;
  factors: Record<AllocationFactorKey, AllocationFactor>;
  /** Eligible creators below this Eligibility Score get no allocation (optional). */
  minEligibilityScore: number | null;
  /** Cap per creator, in % of the program (optional). */
  maxSharePct: number | null;
  /** Floor per creator, in % of the program (optional). */
  minSharePct: number | null;
  /** Keep only the top N recipients by allocation score (optional). */
  maxRecipients: number | null;
  pool: AllocationPool;
  visibility: AllocationVisibility;
};

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
  enabled: false,
  method: "weighted",
  factors: {
    eligibilityScore: { enabled: true, weight: 30 },
    points: { enabled: true, weight: 30 },
    score: { enabled: true, weight: 20 },
    level: { enabled: false, weight: 0 },
    achievements: { enabled: true, weight: 10 },
    graduations: { enabled: true, weight: 10 },
    organic: { enabled: false, weight: 0 },
    seasonRank: { enabled: false, weight: 0 },
  },
  minEligibilityScore: null,
  maxSharePct: null,
  minSharePct: null,
  maxRecipients: null,
  pool: { enabled: false, total: null, unit: null },
  visibility: "hidden",
};

/** Immutable history entry: editing the config ALWAYS creates a new version. */
export type AllocationConfigVersion = {
  version: number;
  config: AllocationConfig;
  note: string | null;
  createdAt: string;
};

export type AllocationConfigRecord = {
  programId: string;
  version: number;
  config: AllocationConfig;
  updatedAt: string;
  history: AllocationConfigVersion[];
};

/* --------------------------------- inputs ---------------------------------- */

/** One row of the latest eligibility batch of a program (read-only source). */
export type AllocationInput = {
  address: string;
  eligibilityStatus: EligibilityStatus;
  eligibilityScore: number;
  ruleVersion: number;
  metrics: {
    points: number | null;
    score: number | null;
    level: number | null;
    achievements: number | null;
    graduations: number | null;
    organic: number | null;
    seasonRank: number | null;
  };
  /** Eligibility snapshot fingerprint → part of the allocation basis hash. */
  sourceFingerprint: string;
  evaluatedAt: string;
};

/* --------------------------------- results --------------------------------- */

/**
 *  • allocated       → eligible creator with a real weight
 *  • pending_data    → eligible, but every enabled factor is N/A (never 0)
 *  • below_threshold → eligible, Eligibility Score under `minEligibilityScore`
 *  • not_selected    → eligible, outside the `maxRecipients` cut
 *  • not_eligible / pending / excluded → mirrors eligibility, no allocation
 */
export const ALLOCATION_STATUSES = [
  "allocated",
  "pending_data",
  "below_threshold",
  "not_selected",
  "not_eligible",
  "pending",
  "excluded",
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABEL: Record<AllocationStatus, string> = {
  allocated: "🟢 Allocated",
  pending_data: "🟡 Pending data",
  below_threshold: "⚪ Below threshold",
  not_selected: "⚪ Not selected",
  not_eligible: "🔴 Not eligible",
  pending: "🟡 Pending",
  excluded: "⛔ Excluded",
};

export type AllocationFactorResult = {
  key: AllocationFactorKey;
  label: string;
  /** Real value; `null` = N/A. */
  value: number | null;
  /** 0–1 relative to the best recipient; `null` = N/A. */
  normalized: number | null;
  weight: number;
};

export type AllocationResult = {
  address: string;
  eligibilityStatus: EligibilityStatus;
  eligibilityScore: number;
  status: AllocationStatus;
  /** 0–100 internal score; `null` = N/A. */
  allocationScore: number | null;
  /** 0–1 share of the program; `null` = no allocation. */
  normalizedWeight: number | null;
  /** 0–100 share of the program; `null` = no allocation. */
  allocationPct: number | null;
  /** Internal calculation ONLY when a pool is configured; otherwise `null`. */
  allocationAmount: number | null;
  factors: AllocationFactorResult[];
  capped: boolean;
  floored: boolean;
  reasons: string[];
};

export type AllocationTotals = {
  evaluated: number;
  eligible: number;
  recipients: number;
  pendingData: number;
  /** Σ allocationPct of recipients (≤ 100). */
  totalPct: number;
  /** 100 − totalPct when caps make a full split impossible. */
  unallocatedPct: number;
  totalAmount: number | null;
  poolTotal: number | null;
  poolUnit: string | null;
};

export type AllocationComputation = {
  method: AllocationMethod;
  results: AllocationResult[];
  totals: AllocationTotals;
  warnings: string[];
};

/* -------------------------------- snapshots -------------------------------- */

export type AllocationSnapshotRow = {
  chainId: number;
  programId: string;
  ruleVersion: number;
  allocationVersion: number;
  basisHash: string;
  eligibilityEvaluatedAt: string;
  creatorAddress: string;
  eligibilityStatus: EligibilityStatus;
  status: AllocationStatus;
  allocationScore: number | null;
  normalizedWeight: number | null;
  allocationPct: number | null;
  allocationAmount: number | null;
  poolTotal: number | null;
  poolUnit: string | null;
  method: AllocationMethod;
  factorsResult: unknown;
  reasons: string[];
  evaluatedAt: string;
  fingerprint: string;
};

export type AllocationSnapshotRecord = {
  creatorAddress: string;
  eligibilityStatus: EligibilityStatus;
  status: AllocationStatus;
  allocationScore: number | null;
  normalizedWeight: number | null;
  allocationPct: number | null;
  allocationAmount: number | null;
  poolTotal: number | null;
  poolUnit: string | null;
  method: AllocationMethod;
  ruleVersion: number;
  allocationVersion: number;
  basisHash: string;
  evaluatedAt: string;
};

/* --------------------------------- engine ---------------------------------- */

export type AllocationEngineState = {
  runId: string | null;
  trigger: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  programsEvaluated: number;
  creatorsEvaluated: number;
  eligible: number;
  recipients: number;
  pendingData: number;
  totalPct: number;
  totalAmount: number | null;
  snapshotsCreated: number;
  duplicates: number;
  errors: number;
  lastError: string | null;
  durationMs: number;
  notes: string[];
};

export const EMPTY_ALLOCATION_STATE: AllocationEngineState = {
  runId: null,
  trigger: null,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  programsEvaluated: 0,
  creatorsEvaluated: 0,
  eligible: 0,
  recipients: 0,
  pendingData: 0,
  totalPct: 0,
  totalAmount: null,
  snapshotsCreated: 0,
  duplicates: 0,
  errors: 0,
  lastError: null,
  durationMs: 0,
  notes: [],
};

export type AllocationProgramRun = {
  programId: string;
  programName: string;
  slug: string;
  ruleVersion: number;
  allocationVersion: number;
  basisHash: string;
  eligibilityEvaluatedAt: string;
  computation: AllocationComputation;
  snapshotsCreated: number;
  duplicates: number;
  error: string | null;
};

export type AllocationRunResult = {
  state: AllocationEngineState;
  programs: AllocationProgramRun[];
  dryRun: boolean;
  skipped: boolean;
  skippedReason: string | null;
};

/** Public view (§ PUBLIC): only what the program's `visibility` allows. */
export type PublicAllocationEntry = {
  rank: number;
  address: string;
  allocationPct: number;
  normalizedWeight: number;
  /** Present only when visibility = "amounts" and the pool is configured. */
  allocationAmount: number | null;
};

export type PublicAllocation = {
  slug: string;
  visible: boolean;
  visibility: AllocationVisibility;
  method: AllocationMethod | null;
  recipients: number;
  totalPct: number | null;
  poolTotal: number | null;
  poolUnit: string | null;
  evaluatedAt: string | null;
  allocationVersion: number | null;
  entries: PublicAllocationEntry[];
  storageReady: boolean;
};
