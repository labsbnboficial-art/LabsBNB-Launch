// 🎁 Fase 2F — pure eligibility rules. No I/O, no RPC, no database: fully testable.
//
// Reuses the existing helpers of the Leaderboard (sha256, slugify, pagination)
// so there is a single implementation of each primitive in the project.
import {
  CRITERIA_KEYS,
  CRITERION_LABEL,
  DEFAULT_REWARD_RULES,
  EVALUATION_WINDOWS,
  REWARD_PROGRAM_STATUSES,
  type CriterionKey,
  type CriterionResult,
  type CriterionRule,
  type EligibilityEvaluation,
  type EligibilityMetrics,
  type EligibilityStatus,
  type EvaluationWindow,
  type ExclusionRules,
  type RewardProgramStatus,
  type RewardRules,
  type RiskFlag,
} from "./rewards-types";

export { clampPagination, isValidAddress, normalizeAddress, paginate, round2, sha256, slugify } from "@/lib/leaderboard/leaderboard-rules";
import { round2 } from "@/lib/leaderboard/leaderboard-rules";

export class RewardsError extends Error {}

/* ------------------------------- validation -------------------------------- */

function num(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new RewardsError("Valor numérico inválido en las reglas.");
  return n;
}

function validateCriterion(key: CriterionKey, input: unknown, fallback: CriterionRule): CriterionRule {
  const raw = (input ?? {}) as Partial<CriterionRule>;
  const minimum = num(raw.minimum, fallback.minimum);
  if (minimum != null && minimum < 0) throw new RewardsError(`El mínimo de "${CRITERION_LABEL[key]}" no puede ser negativo.`);
  if (key === "seasonRank" && minimum != null && minimum < 1) {
    throw new RewardsError("El rango máximo de temporada debe ser 1 o mayor.");
  }
  const weight = num(raw.weight, fallback.weight) ?? 0;
  if (weight < 0 || weight > 100) throw new RewardsError(`El peso de "${CRITERION_LABEL[key]}" debe estar entre 0 y 100.`);
  return {
    enabled: raw.enabled === undefined ? fallback.enabled : !!raw.enabled,
    minimum,
    required: raw.required === undefined ? fallback.required : !!raw.required,
    weight,
  };
}

function validateExclusions(input: unknown): ExclusionRules {
  const raw = (input ?? {}) as Partial<ExclusionRules>;
  const fb = DEFAULT_REWARD_RULES.exclusions;
  const blocked = Array.isArray(raw.blockedCreators) ? raw.blockedCreators : fb.blockedCreators;
  const cleaned: string[] = [];
  for (const entry of blocked) {
    const addr = String(entry).trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) throw new RewardsError(`Dirección inválida en la lista de exclusión: ${entry}`);
    if (!cleaned.includes(addr)) cleaned.push(addr);
  }
  return {
    selfTradeDetected: raw.selfTradeDetected === undefined ? fb.selfTradeDetected : !!raw.selfTradeDetected,
    circularActivity: raw.circularActivity === undefined ? fb.circularActivity : !!raw.circularActivity,
    nonOrganicActivity: raw.nonOrganicActivity === undefined ? fb.nonOrganicActivity : !!raw.nonOrganicActivity,
    requireSeasonParticipation:
      raw.requireSeasonParticipation === undefined ? fb.requireSeasonParticipation : !!raw.requireSeasonParticipation,
    blockedCreators: cleaned,
  };
}

/** Server-side validation of the JSONB rules (§5). Never trust the client. */
export function validateRewardRules(input: unknown): RewardRules {
  if (input == null || typeof input !== "object") throw new RewardsError("Reglas inválidas.");
  const raw = input as { criteria?: Record<string, unknown>; exclusions?: unknown };
  const criteria = {} as Record<CriterionKey, CriterionRule>;
  for (const key of CRITERIA_KEYS) {
    criteria[key] = validateCriterion(key, raw.criteria?.[key], DEFAULT_REWARD_RULES.criteria[key]);
  }
  const enabled = CRITERIA_KEYS.filter((k) => criteria[k].enabled);
  if (!enabled.length) throw new RewardsError("Al menos un criterio debe estar habilitado.");
  if (enabled.every((k) => criteria[k].weight === 0)) {
    throw new RewardsError("Al menos un criterio habilitado debe tener peso mayor que 0.");
  }
  return { criteria, exclusions: validateExclusions(raw.exclusions) };
}

export function isProgramStatus(value: string): value is RewardProgramStatus {
  return (REWARD_PROGRAM_STATUSES as readonly string[]).includes(value);
}

export function isEvaluationWindow(value: string): value is EvaluationWindow {
  return (EVALUATION_WINDOWS as readonly string[]).includes(value);
}

/* --------------------------------- lifecycle -------------------------------- */

const TRANSITIONS: Record<RewardProgramStatus, RewardProgramStatus[]> = {
  draft: ["scheduled", "active", "archived"],
  scheduled: ["active", "draft", "archived"],
  active: ["ended"],
  ended: ["archived"],
  archived: [],
};

export function assertProgramTransition(from: RewardProgramStatus, to: RewardProgramStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new RewardsError(`Transición no permitida: ${from} → ${to}.`);
  }
}

/** §22 — once active, the rules are versioned, never silently edited. */
export function isProgramLocked(status: RewardProgramStatus): boolean {
  return status === "active" || status === "ended" || status === "archived";
}

export function isProgramImmutable(status: RewardProgramStatus): boolean {
  return status === "ended" || status === "archived";
}

export function validateProgramDates(startsAt: string | null, endsAt: string | null): {
  startsAt: string | null;
  endsAt: string | null;
} {
  const s = startsAt ? Date.parse(startsAt) : null;
  const e = endsAt ? Date.parse(endsAt) : null;
  if (s != null && Number.isNaN(s)) throw new RewardsError("Fecha de inicio inválida.");
  if (e != null && Number.isNaN(e)) throw new RewardsError("Fecha de fin inválida.");
  if (s != null && e != null && e <= s) throw new RewardsError("La fecha de fin debe ser posterior a la de inicio.");
  return {
    startsAt: s == null ? null : new Date(s).toISOString(),
    endsAt: e == null ? null : new Date(e).toISOString(),
  };
}

export function effectiveProgramStatus(
  program: { status: RewardProgramStatus; startsAt: string | null; endsAt: string | null },
  now = Date.now(),
): RewardProgramStatus {
  if (program.status === "scheduled" && program.startsAt && Date.parse(program.startsAt) <= now) return "active";
  if (program.status === "active" && program.endsAt && Date.parse(program.endsAt) <= now) return "ended";
  return program.status;
}

/* ------------------------------ evaluation window --------------------------- */

export type ResolvedWindow = { start: string | null; end: string | null; key: string };

/**
 * §11/§12 — the window is the ONLY source of truth for attributing activity.
 * A season-linked program never credits activity outside the season.
 */
export function resolveWindow(
  program: {
    evaluationWindow: EvaluationWindow;
    evaluationStart: string | null;
    evaluationEnd: string | null;
  },
  season: { startsAt: string; endsAt: string } | null,
): ResolvedWindow {
  if (program.evaluationWindow === "season") {
    if (!season) throw new RewardsError("El programa está vinculado a una temporada inexistente.");
    return { start: season.startsAt, end: season.endsAt, key: `${season.startsAt}|${season.endsAt}` };
  }
  if (program.evaluationWindow === "historical") {
    if (!program.evaluationStart || !program.evaluationEnd) {
      throw new RewardsError("Una ventana histórica requiere fecha de inicio y de fin.");
    }
    const dates = validateProgramDates(program.evaluationStart, program.evaluationEnd);
    return { start: dates.startsAt, end: dates.endsAt, key: `${dates.startsAt}|${dates.endsAt}` };
  }
  return { start: null, end: null, key: "current" };
}

export function withinWindow(timestamp: string | number | Date | null, window: ResolvedWindow): boolean {
  if (!timestamp) return false;
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return false;
  if (window.start && t < Date.parse(window.start)) return false;
  if (window.end && t >= Date.parse(window.end)) return false;
  return true;
}

/* -------------------------------- fingerprint ------------------------------- */

export const EVALUATION_BUCKET_MINUTES = 15;

/** Deterministic bucket so cron/retry/backfill collapse into one snapshot. */
export function evaluationBucket(at: Date | number = Date.now(), minutes = EVALUATION_BUCKET_MINUTES): string {
  const ms = minutes * 60_000;
  return new Date(Math.floor(new Date(at).getTime() / ms) * ms).toISOString();
}

/** §10 — ELIGIBILITY|chain|program|ruleVersion|creator|window|bucket */
export function eligibilityFingerprintInput(parts: {
  chainId: number;
  programId: string;
  ruleVersion: number;
  creatorAddress: string;
  windowKey: string;
  evaluatedAt: string;
}): string {
  return [
    "ELIGIBILITY",
    parts.chainId,
    parts.programId,
    `v${parts.ruleVersion}`,
    parts.creatorAddress.toLowerCase(),
    parts.windowKey,
    parts.evaluatedAt,
  ].join("|");
}

/* -------------------------------- evaluation -------------------------------- */

const metricOf = (metrics: EligibilityMetrics, key: CriterionKey): number | null => {
  switch (key) {
    case "points":
      return metrics.points;
    case "score":
      return metrics.score;
    case "level":
      return metrics.level;
    case "achievements":
      return metrics.achievements;
    case "graduations":
      return metrics.graduations;
    case "organic":
      return metrics.organic;
    case "seasonRank":
      return metrics.seasonRank;
  }
};

/** One criterion → PASS / FAIL / N/A (§6). Unavailable data is NEVER a FAIL. */
export function evaluateCriterion(key: CriterionKey, rule: CriterionRule, value: number | null): CriterionResult {
  const base = {
    key,
    label: CRITERION_LABEL[key],
    required: rule.required,
    target: rule.minimum,
    weight: rule.weight,
  };
  if (value == null || !Number.isFinite(value)) {
    return { ...base, status: "na", value: null, progress: null };
  }
  // `seasonRank` is inverted: lower is better, `minimum` behaves as max rank.
  if (key === "seasonRank") {
    if (rule.minimum == null) return { ...base, status: "pass", value, progress: 1 };
    const pass = value <= rule.minimum;
    return { ...base, status: pass ? "pass" : "fail", value, progress: pass ? 1 : round2(rule.minimum / value) };
  }
  const target = rule.minimum ?? 0;
  if (target <= 0) return { ...base, status: "pass", value, progress: 1 };
  const pass = value >= target;
  return { ...base, status: pass ? "pass" : "fail", value, progress: pass ? 1 : round2(value / target) };
}

/**
 * §7 — Eligibility Score: weighted progress over the ENABLED criteria.
 * Unavailable criteria are excluded and their weight redistributed (never 0).
 */
export function eligibilityScore(results: CriterionResult[]): number {
  const usable = results.filter((r) => r.status !== "na" && r.weight > 0);
  const total = usable.reduce((s, r) => s + r.weight, 0);
  if (!total) return 0;
  const score = usable.reduce((s, r) => s + Math.max(0, Math.min(1, r.progress ?? 0)) * r.weight, 0) / total;
  return round2(Math.max(0, Math.min(100, score * 100)));
}

export type EvaluationContext = {
  address: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  metrics: EligibilityMetrics;
  riskFlags: RiskFlag[];
  /** `false` only when the program requires season participation and there is none. */
  participatesInSeason?: boolean | null;
};

/** Full evaluation of one creator against one program's rules. */
export function evaluateEligibility(ctx: EvaluationContext, rules: RewardRules): EligibilityEvaluation {
  const criteria: CriterionResult[] = CRITERIA_KEYS.filter((k) => rules.criteria[k].enabled).map((k) =>
    evaluateCriterion(k, rules.criteria[k], metricOf(ctx.metrics, k)),
  );

  const exclusionReasons: string[] = [];
  const flags = new Set(ctx.riskFlags);
  const blocked = rules.exclusions.blockedCreators.includes(ctx.address.toLowerCase());
  if (blocked) exclusionReasons.push("blacklisted_creator");
  if (rules.exclusions.selfTradeDetected && flags.has("self_trade_detected")) exclusionReasons.push("self_trade_detected");
  if (rules.exclusions.circularActivity && flags.has("circular_activity")) exclusionReasons.push("circular_activity");
  if (rules.exclusions.nonOrganicActivity && flags.has("non_organic_activity")) exclusionReasons.push("non_organic_activity");
  if (rules.exclusions.requireSeasonParticipation && ctx.participatesInSeason === false) {
    exclusionReasons.push("no_season_participation");
  }

  const missingCriteria = criteria.filter((c) => c.status === "na").map((c) => c.key);
  const requiredMissing = criteria.some((c) => c.required && c.status === "na");
  const requiredFailed = criteria.some((c) => c.required && c.status === "fail");

  let status: EligibilityStatus;
  if (exclusionReasons.length) status = "excluded";
  else if (requiredFailed) status = "not_eligible";
  else if (requiredMissing) status = "pending";
  else if (rules.exclusions.requireSeasonParticipation && ctx.participatesInSeason == null) status = "pending";
  else status = "eligible";

  return {
    address: ctx.address.toLowerCase(),
    displayName: ctx.displayName ?? null,
    avatarUrl: ctx.avatarUrl ?? null,
    status,
    eligibilityScore: eligibilityScore(criteria),
    criteria,
    metrics: ctx.metrics,
    riskFlags: [...flags],
    exclusionReasons,
    missingCriteria,
  };
}

/**
 * Anti-farming signals derived from the EXISTING organic activity data (§18/§19).
 * We never invent a real-world identity: these are behavioural flags only.
 */
export function riskFlagsFrom(stats: {
  volume24h: number | null;
  organicVolume24h: number | null;
  trades24h: number | null;
  uniqueBuyers: number | null;
  uniqueSellers: number | null;
  organicScore: number | null;
}): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const vol = stats.volume24h ?? 0;
  const organic = stats.organicVolume24h;
  const trades = stats.trades24h ?? 0;

  if (trades >= 10 && (stats.uniqueBuyers ?? 0) <= 1 && (stats.uniqueSellers ?? 0) <= 1) {
    flags.push("self_trade_detected");
  }
  if (trades >= 20 && (stats.uniqueBuyers ?? 0) > 0 && trades / Math.max(1, stats.uniqueBuyers ?? 1) >= 25) {
    flags.push("circular_activity");
  }
  if (vol > 0 && organic != null && organic / vol < 0.25 && trades >= 10) {
    flags.push("non_organic_activity");
  }
  return flags;
}

/** Deterministic ordering of the eligibility table (never random). */
export function compareEvaluations(a: EligibilityEvaluation, b: EligibilityEvaluation): number {
  const rank: Record<EligibilityStatus, number> = { eligible: 0, pending: 1, not_eligible: 2, excluded: 3 };
  return (
    rank[a.status] - rank[b.status] ||
    b.eligibilityScore - a.eligibilityScore ||
    (b.metrics.points ?? -1) - (a.metrics.points ?? -1) ||
    (b.metrics.score ?? -1) - (a.metrics.score ?? -1) ||
    (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)
  );
}

export function countStatuses(entries: EligibilityEvaluation[]): Record<EligibilityStatus, number> {
  const counts: Record<EligibilityStatus, number> = { eligible: 0, not_eligible: 0, pending: 0, excluded: 0 };
  for (const e of entries) counts[e.status] += 1;
  return counts;
}
