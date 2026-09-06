// 🏆 Fase 2E — Creator Leaderboard + Seasons: PURE rules (no I/O).
//
// Everything here is deterministic and unit-tested: normalization, weight
// redistribution, tie-breakers, ranking, pagination, season validation and
// snapshot fingerprints.
//
// Golden rule: `null` means UNAVAILABLE. It is never coerced to 0 — an
// unavailable metric drops out of the formula and its weight is redistributed
// proportionally among the remaining available metrics.
import {
  DEFAULT_LEADERBOARD_WEIGHTS,
  DEFAULT_SEASON_RULES,
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_METRICS,
  SEASON_STATUSES,
  type LeaderboardCandidate,
  type LeaderboardCategory,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type MetricWeights,
  type RawMetrics,
  type SeasonRules,
  type SeasonStatus,
} from "./leaderboard-types";

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class LeaderboardError extends Error {}

/** Internal comparisons are always lowercase; checksum is presentation only. */
export function normalizeAddress(address: string): string {
  const value = (address ?? "").trim();
  if (!ADDRESS_RE.test(value)) throw new LeaderboardError("Dirección inválida.");
  return value.toLowerCase();
}

export function isValidAddress(address: string): boolean {
  return ADDRESS_RE.test((address ?? "").trim());
}

/* ------------------------------ normalization ------------------------------ */

/**
 * Min–max normalization to 0–100 over the candidate set.
 *  • `null` inputs stay `null` (unavailable).
 *  • all equal & > 0 → every available value becomes 100.
 *  • all equal & = 0 → every available value becomes 0 (a real zero).
 */
export function normalizeValues(values: (number | null)[]): (number | null)[] {
  const available = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!available.length) return values.map(() => null);
  const min = Math.min(...available);
  const max = Math.max(...available);
  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return null;
    if (max === min) return max > 0 ? 100 : 0;
    return round2(((v - min) / (max - min)) * 100);
  });
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Redistributes the weights of unavailable metrics proportionally among the
 * available ones. Documented rule of §5: never invent a value.
 */
export function redistributeWeights(
  weights: MetricWeights,
  available: LeaderboardMetric[],
): { weights: Partial<MetricWeights>; missing: LeaderboardMetric[] } {
  const set = new Set(available);
  const missing = LEADERBOARD_METRICS.filter((m) => !set.has(m) && (weights[m] ?? 0) > 0);
  const total = available.reduce((s, m) => s + (weights[m] ?? 0), 0);
  const out: Partial<MetricWeights> = {};
  if (total <= 0) return { weights: out, missing };
  for (const m of available) out[m] = ((weights[m] ?? 0) / total) * 100;
  return { weights: out, missing };
}

/** Overall Leaderboard Score from already-normalized (0–100) components. */
export function computeOverallScore(
  components: Record<LeaderboardMetric, number | null>,
  weights: MetricWeights = DEFAULT_LEADERBOARD_WEIGHTS,
): { overall: number; missing: LeaderboardMetric[]; usedWeights: Partial<MetricWeights> } {
  const available = LEADERBOARD_METRICS.filter((m) => components[m] != null && (weights[m] ?? 0) > 0);
  const { weights: used, missing } = redistributeWeights(weights, available);
  let overall = 0;
  for (const m of available) overall += ((components[m] as number) * (used[m] ?? 0)) / 100;
  return { overall: round2(Math.max(0, Math.min(100, overall))), missing, usedWeights: used };
}

/* -------------------------------- ranking ---------------------------------- */

const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? -Infinity : v);

/**
 * Deterministic tie-break chain (§11):
 * overall → points → score → graduations → organic → address (lexicographic).
 * Never random.
 */
export function compareEntries(
  a: { overallScore: number; raw: RawMetrics; address: string },
  b: { overallScore: number; raw: RawMetrics; address: string },
): number {
  return (
    b.overallScore - a.overallScore ||
    num(b.raw.points) - num(a.raw.points) ||
    num(b.raw.score) - num(a.raw.score) ||
    num(b.raw.graduations) - num(a.raw.graduations) ||
    num(b.raw.organic) - num(a.raw.organic) ||
    (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)
  );
}

export type ScoredCandidate = LeaderboardCandidate & {
  overallScore: number;
  components: Record<LeaderboardMetric, number | null>;
  missingMetrics: LeaderboardMetric[];
};

/**
 * Normalizes the whole candidate set, computes the Overall Leaderboard Score
 * for each creator and returns them sorted with deterministic tie-breaks.
 */
export function scoreCandidates(
  candidates: LeaderboardCandidate[],
  weights: MetricWeights = DEFAULT_LEADERBOARD_WEIGHTS,
): { scored: ScoredCandidate[]; unavailableMetrics: LeaderboardMetric[] } {
  if (!candidates.length) return { scored: [], unavailableMetrics: [...LEADERBOARD_METRICS] };

  const normalized: Record<LeaderboardMetric, (number | null)[]> = {
    points: normalizeValues(candidates.map((c) => c.raw.points)),
    score: normalizeValues(candidates.map((c) => c.raw.score)),
    graduations: normalizeValues(candidates.map((c) => c.raw.graduations)),
    trending: normalizeValues(candidates.map((c) => c.raw.trending)),
    organic: normalizeValues(candidates.map((c) => c.raw.organic)),
  };

  const unavailableMetrics = LEADERBOARD_METRICS.filter((m) => normalized[m].every((v) => v == null));

  const scored = candidates.map((c, i) => {
    const components = {
      points: normalized.points[i] ?? null,
      score: normalized.score[i] ?? null,
      graduations: normalized.graduations[i] ?? null,
      trending: normalized.trending[i] ?? null,
      organic: normalized.organic[i] ?? null,
    } satisfies Record<LeaderboardMetric, number | null>;
    const { overall, missing } = computeOverallScore(components, weights);
    return { ...c, overallScore: overall, components, missingMetrics: missing };
  });

  scored.sort(compareEntries);
  return { scored, unavailableMetrics };
}

/** Category comparators — applied AFTER filtering, never on raw array index. */
export function compareByCategory(category: LeaderboardCategory) {
  return (a: ScoredCandidate, b: ScoredCandidate): number => {
    switch (category) {
      case "points":
        return num(b.raw.points) - num(a.raw.points) || compareEntries(a, b);
      case "score":
        return num(b.raw.score) - num(a.raw.score) || compareEntries(a, b);
      case "graduators":
        return num(b.raw.graduations) - num(a.raw.graduations) || compareEntries(a, b);
      case "trending":
        return num(b.raw.trending) - num(a.raw.trending) || compareEntries(a, b);
      case "rising":
        return num(b.extras.risingCount) - num(a.extras.risingCount) || compareEntries(a, b);
      case "whale":
        return num(b.extras.whaleTrades) - num(a.extras.whaleTrades) || compareEntries(a, b);
      case "community":
        return (
          num(b.extras.uniqueBuyers) - num(a.extras.uniqueBuyers) ||
          num(b.extras.holders) - num(a.extras.holders) ||
          compareEntries(a, b)
        );
      default:
        return compareEntries(a, b);
    }
  };
}

/**
 * Assigns rank 1..N AFTER all filtering + sorting (§38). Rank is never an
 * array index of the unfiltered set.
 */
export function assignRanks(
  scored: ScoredCandidate[],
  history: Map<string, { previousRank: number | null; bestRank: number | null }> = new Map(),
): LeaderboardEntry[] {
  return scored.map((c, i) => {
    const h = history.get(c.address) ?? { previousRank: null, bestRank: null };
    const rank = i + 1;
    return {
      ...c,
      rank,
      previousRank: h.previousRank,
      rankChange: h.previousRank == null ? null : h.previousRank - rank,
      isNew: h.previousRank == null,
      bestRank: h.bestRank == null ? rank : Math.min(h.bestRank, rank),
    };
  });
}

export function isCategory(value: string): value is LeaderboardCategory {
  return (LEADERBOARD_CATEGORIES as readonly string[]).includes(value);
}

/* ------------------------------- pagination -------------------------------- */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function clampPagination(pageInput: unknown, pageSizeInput: unknown): { page: number; pageSize: number } {
  const p = Number(pageInput);
  const s = Number(pageSizeInput);
  const page = Number.isFinite(p) ? Math.max(1, Math.trunc(p)) : 1;
  const pageSize = Number.isFinite(s)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(s)))
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/* -------------------------------- seasons ---------------------------------- */

export function isSeasonStatus(value: string): value is SeasonStatus {
  return (SEASON_STATUSES as readonly string[]).includes(value);
}

export function slugify(input: string): string {
  const slug = (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) throw new LeaderboardError("El nombre de la temporada no genera un slug válido.");
  return slug;
}

/** Season weights MUST sum exactly 100 (§17). Server-side validation. */
export function validateSeasonRules(input: unknown): SeasonRules {
  const raw = (input ?? {}) as Partial<SeasonRules> & { weights?: Partial<MetricWeights> };
  const weights = {} as MetricWeights;
  for (const m of LEADERBOARD_METRICS) {
    const v = Number(raw.weights?.[m] ?? DEFAULT_SEASON_RULES.weights[m]);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new LeaderboardError(`Peso inválido para "${m}": debe estar entre 0 y 100.`);
    }
    weights[m] = Math.round(v * 100) / 100;
  }
  const total = round2(LEADERBOARD_METRICS.reduce((s, m) => s + weights[m], 0));
  if (total !== 100) {
    throw new LeaderboardError(`Los pesos de la temporada deben sumar exactamente 100% (actual: ${total}%).`);
  }
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    pointsEnabled: bool(raw.pointsEnabled, true),
    scoreEnabled: bool(raw.scoreEnabled, true),
    graduationsEnabled: bool(raw.graduationsEnabled, true),
    trendingEnabled: bool(raw.trendingEnabled, true),
    organicEnabled: bool(raw.organicEnabled, true),
    weights,
  };
}

/** Weights of the metrics a season has DISABLED are zeroed and redistributed. */
export function seasonWeights(rules: SeasonRules): MetricWeights {
  const enabled: Record<LeaderboardMetric, boolean> = {
    points: rules.pointsEnabled,
    score: rules.scoreEnabled,
    graduations: rules.graduationsEnabled,
    trending: rules.trendingEnabled,
    organic: rules.organicEnabled,
  };
  const out = {} as MetricWeights;
  for (const m of LEADERBOARD_METRICS) out[m] = enabled[m] ? rules.weights[m] : 0;
  return out;
}

export function validateSeasonDates(startsAt: string, endsAt: string): { startsAt: string; endsAt: string } {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new LeaderboardError("Fechas de temporada inválidas.");
  if (e <= s) throw new LeaderboardError("`ends_at` debe ser posterior a `starts_at`.");
  return { startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() };
}

export type SeasonWindow = { id?: string; startsAt: string; endsAt: string; status?: SeasonStatus };

/** Half-open window: starts_at <= t < ends_at (§19). */
export function withinSeason(timestamp: string | number | Date, season: SeasonWindow): boolean {
  const t = timestamp instanceof Date ? timestamp.getTime() : typeof timestamp === "number" ? timestamp : Date.parse(String(timestamp));
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(season.startsAt) && t < Date.parse(season.endsAt);
}

export function seasonsOverlap(a: SeasonWindow, b: SeasonWindow): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

/** Derived status for display: a `scheduled` season whose window opened is live. */
export function effectiveSeasonStatus(season: { status: SeasonStatus; startsAt: string; endsAt: string }, now = Date.now()): SeasonStatus {
  if (season.status === "draft" || season.status === "archived") return season.status;
  if (season.status === "ended") return "ended";
  const start = Date.parse(season.startsAt);
  const end = Date.parse(season.endsAt);
  if (now >= end) return "ended";
  if (now < start) return "scheduled";
  return season.status === "active" ? "active" : "scheduled";
}

export function isSeasonImmutable(status: SeasonStatus): boolean {
  return status === "ended" || status === "archived";
}

/** Allowed status transitions (§33). */
const TRANSITIONS: Record<SeasonStatus, SeasonStatus[]> = {
  draft: ["scheduled", "active", "archived"],
  scheduled: ["active", "draft", "archived"],
  active: ["ended"],
  ended: ["archived"],
  archived: [],
};

export function assertTransition(from: SeasonStatus, to: SeasonStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new LeaderboardError(`Transición de temporada no permitida: ${from} → ${to}.`);
  }
}

export function countdown(endsAt: string, now = Date.now()): { ended: boolean; days: number; hours: number; minutes: number } {
  const diff = Date.parse(endsAt) - now;
  if (!Number.isFinite(diff) || diff <= 0) return { ended: true, days: 0, hours: 0, minutes: 0 };
  const minutes = Math.floor(diff / 60_000);
  return { ended: false, days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/* ------------------------------ fingerprints ------------------------------- */

/** Snapshots are bucketed so a cron running every minute cannot spam rows. */
export const SNAPSHOT_BUCKET_MINUTES = 15;

export function snapshotBucket(at: Date | number = Date.now(), minutes = SNAPSHOT_BUCKET_MINUTES): string {
  const ms = at instanceof Date ? at.getTime() : at;
  const size = Math.max(1, minutes) * 60_000;
  return new Date(Math.floor(ms / size) * size).toISOString();
}

export function leaderboardFingerprintInput(parts: {
  chainId: number;
  creatorAddress: string;
  snapshotAt: string;
}): string {
  return ["LEADERBOARD", String(parts.chainId), parts.creatorAddress.toLowerCase(), parts.snapshotAt].join("|");
}

export function seasonFingerprintInput(parts: {
  chainId: number;
  seasonId: string;
  creatorAddress: string;
  snapshotAt: string;
  final?: boolean;
}): string {
  return [
    "SEASON",
    String(parts.chainId),
    parts.seasonId,
    parts.creatorAddress.toLowerCase(),
    parts.final ? "FINAL" : parts.snapshotAt,
  ].join("|");
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------- derived raw metrics --------------------------- */

/**
 * Trending performance metric of a creator, derived from `trending_snapshots`.
 * Weighted so a single snapshot repeated over time cannot inflate the ranking
 * as much as distinct achievements (§9).
 */
export function trendingMetric(input: {
  top5: number;
  top10: number;
  risingFast: number;
  bestRank: number | null;
  hasHistory: boolean;
}): number | null {
  if (!input.hasHistory) return null;
  const dampen = (n: number) => (n > 0 ? Math.log10(1 + n) : 0);
  const rankBonus = input.bestRank == null ? 0 : Math.max(0, 11 - Math.min(10, input.bestRank)) / 10;
  return round2(dampen(input.top5) * 3 + dampen(input.top10) * 1.5 + dampen(input.risingFast) * 1 + rankBonus);
}

/**
 * Organic activity metric: real organic volume, dampened logarithmically so a
 * single whale wallet cannot dominate. Inherits every existing anti-farming
 * filter because the input already comes from the organic-only aggregation.
 */
export function organicMetric(organicVolume: number | null): number | null {
  if (organicVolume == null || !Number.isFinite(organicVolume)) return null;
  return round2(Math.log10(1 + Math.max(0, organicVolume)));
}
