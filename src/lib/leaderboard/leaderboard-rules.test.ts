import { describe, expect, it } from "vitest";
import {
  assignRanks,
  assertTransition,
  clampPagination,
  compareByCategory,
  compareEntries,
  computeOverallScore,
  countdown,
  effectiveSeasonStatus,
  isSeasonImmutable,
  leaderboardFingerprintInput,
  LeaderboardError,
  normalizeAddress,
  normalizeValues,
  organicMetric,
  paginate,
  redistributeWeights,
  scoreCandidates,
  seasonFingerprintInput,
  seasonsOverlap,
  seasonWeights,
  sha256,
  slugify,
  snapshotBucket,
  trendingMetric,
  validateSeasonDates,
  validateSeasonRules,
  withinSeason,
} from "./leaderboard-rules";
import {
  DEFAULT_LEADERBOARD_WEIGHTS,
  DEFAULT_SEASON_RULES,
  type LeaderboardCandidate,
  type LeaderboardMetric,
} from "./leaderboard-types";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

function candidate(address: string, raw: Partial<LeaderboardCandidate["raw"]>, extras: Partial<LeaderboardCandidate["extras"]> = {}): LeaderboardCandidate {
  return {
    address,
    displayName: null,
    avatarUrl: null,
    level: null,
    raw: { points: 0, score: 0, graduations: 0, trending: 0, organic: 0, ...raw },
    extras: {
      tokensCreated: 0,
      uniqueBuyers: null,
      holders: null,
      whaleTrades: null,
      risingCount: null,
      top5: null,
      top10: null,
      bestTrendingRank: null,
      organicVolume24h: null,
      ...extras,
    },
    achievementBadges: [],
  };
}

describe("address normalization", () => {
  it("lowercases and rejects invalid addresses", () => {
    expect(normalizeAddress("0xABCDEF0123456789abcdef0123456789ABCDEF01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
    expect(() => normalizeAddress("nope")).toThrow(LeaderboardError);
  });

  it("treats checksum and lowercase as the same creator", () => {
    expect(normalizeAddress(A.toUpperCase().replace("0X", "0x"))).toBe(normalizeAddress(A));
  });
});

describe("normalizeValues", () => {
  it("maps min→0 and max→100", () => {
    expect(normalizeValues([0, 5, 10])).toEqual([0, 50, 100]);
  });
  it("keeps nulls as unavailable", () => {
    expect(normalizeValues([1, null, 3])).toEqual([0, null, 100]);
  });
  it("returns all nulls when nothing is available", () => {
    expect(normalizeValues([null, null])).toEqual([null, null]);
  });
  it("all-equal positive values become 100, all-zero stays 0", () => {
    expect(normalizeValues([7, 7])).toEqual([100, 100]);
    expect(normalizeValues([0, 0])).toEqual([0, 0]);
  });
});

describe("weight redistribution", () => {
  it("redistributes missing weight proportionally", () => {
    const { weights, missing } = redistributeWeights(DEFAULT_LEADERBOARD_WEIGHTS, ["points", "score"]);
    expect(missing).toEqual(["graduations", "trending", "organic"]);
    expect(Math.round((weights.points ?? 0) + (weights.score ?? 0))).toBe(100);
    expect(Math.round(weights.points ?? 0)).toBe(62); // 40/65
  });

  it("overall ignores unavailable metrics instead of treating them as 0", () => {
    const all = computeOverallScore({ points: 100, score: 100, graduations: 100, trending: 100, organic: 100 });
    const partial = computeOverallScore({ points: 100, score: 100, graduations: null, trending: null, organic: null });
    expect(all.overall).toBe(100);
    expect(partial.overall).toBe(100);
    expect(partial.missing).toEqual(["graduations", "trending", "organic"]);
  });

  it("a real zero still lowers the score", () => {
    const withZero = computeOverallScore({ points: 0, score: 100, graduations: null, trending: null, organic: null });
    expect(withZero.overall).toBeLessThan(100);
  });

  it("returns 0 when no metric is available at all", () => {
    const none = computeOverallScore({ points: null, score: null, graduations: null, trending: null, organic: null });
    expect(none.overall).toBe(0);
    expect(none.missing).toHaveLength(5);
  });
});

describe("ranking + tie-breakers", () => {
  it("orders by overall score descending", () => {
    const { scored } = scoreCandidates([
      candidate(A, { points: 10 }),
      candidate(B, { points: 100 }),
      candidate(C, { points: 50 }),
    ]);
    expect(scored.map((s) => s.address)).toEqual([B, C, A]);
  });

  it("breaks ties by points, then score, then graduations, then organic, then address", () => {
    const tie = { overallScore: 50, raw: { points: 10, score: 10, graduations: 1, trending: 1, organic: 1 } };
    expect(compareEntries({ ...tie, address: B }, { ...tie, address: A })).toBeGreaterThan(0);
    expect(
      compareEntries(
        { ...tie, address: A, raw: { ...tie.raw, points: 20 } },
        { ...tie, address: B },
      ),
    ).toBeLessThan(0);
  });

  it("is deterministic across repeated runs", () => {
    const list = [candidate(C, { points: 5 }), candidate(A, { points: 5 }), candidate(B, { points: 5 })];
    const a = scoreCandidates(list).scored.map((s) => s.address);
    const b = scoreCandidates([...list].reverse()).scored.map((s) => s.address);
    expect(a).toEqual(b);
    expect(a).toEqual([A, B, C]);
  });

  it("reports metrics unavailable for the whole run", () => {
    const { unavailableMetrics } = scoreCandidates([
      candidate(A, { trending: null, organic: null }),
      candidate(B, { trending: null, organic: null }),
    ]);
    expect(unavailableMetrics).toEqual(["trending", "organic"]);
  });

  it("assigns rank 1..N after sorting, never the raw index", () => {
    const { scored } = scoreCandidates([candidate(A, { points: 1 }), candidate(B, { points: 9 })]);
    const ranked = assignRanks(scored);
    expect(ranked.map((r) => [r.address, r.rank])).toEqual([
      [B, 1],
      [A, 2],
    ]);
  });

  it("computes rank change against the previous snapshot and flags NEW", () => {
    const { scored } = scoreCandidates([candidate(A, { points: 9 }), candidate(B, { points: 1 })]);
    const ranked = assignRanks(
      scored,
      new Map([[A, { previousRank: 4, bestRank: 3 }]]),
    );
    expect(ranked[0]!.rankChange).toBe(3);
    expect(ranked[0]!.bestRank).toBe(1);
    expect(ranked[1]!.isNew).toBe(true);
    expect(ranked[1]!.rankChange).toBeNull();
  });

  it("sorts category tabs by their own metric", () => {
    const { scored } = scoreCandidates([
      candidate(A, { points: 1 }, { whaleTrades: 9 }),
      candidate(B, { points: 100 }, { whaleTrades: 0 }),
    ]);
    const whale = [...scored].sort(compareByCategory("whale"));
    expect(whale[0]!.address).toBe(A);
    const overall = [...scored].sort(compareByCategory("overall"));
    expect(overall[0]!.address).toBe(B);
  });
});

describe("pagination", () => {
  it("defaults to 25 and caps at 100", () => {
    expect(clampPagination(undefined, undefined)).toEqual({ page: 1, pageSize: 25 });
    expect(clampPagination(0, 500)).toEqual({ page: 1, pageSize: 100 });
    expect(clampPagination(-3, 10)).toEqual({ page: 1, pageSize: 10 });
    expect(clampPagination("2", "5")).toEqual({ page: 2, pageSize: 5 });
  });

  it("slices the right page", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(paginate(rows, 2, 2)).toEqual([3, 4]);
    expect(paginate(rows, 9, 2)).toEqual([]);
  });
});

describe("season rules", () => {
  it("accepts weights that sum exactly 100", () => {
    expect(validateSeasonRules(DEFAULT_SEASON_RULES).weights.points).toBe(40);
  });

  it("rejects weights that do not sum 100", () => {
    expect(() =>
      validateSeasonRules({ weights: { points: 50, score: 25, graduations: 15, trending: 10, organic: 10 } }),
    ).toThrow(/100%/);
  });

  it("rejects out-of-range weights", () => {
    expect(() =>
      validateSeasonRules({ weights: { points: -5, score: 45, graduations: 30, trending: 15, organic: 15 } }),
    ).toThrow(LeaderboardError);
  });

  it("zeroes the weight of disabled metrics", () => {
    const w = seasonWeights({ ...DEFAULT_SEASON_RULES, trendingEnabled: false });
    expect(w.trending).toBe(0);
    expect(w.points).toBe(40);
  });

  it("validates dates and rejects ends_at <= starts_at", () => {
    const ok = validateSeasonDates("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    expect(ok.endsAt).toBe("2026-02-01T00:00:00.000Z");
    expect(() => validateSeasonDates("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z")).toThrow(LeaderboardError);
    expect(() => validateSeasonDates("nope", "2026-01-01T00:00:00Z")).toThrow(LeaderboardError);
  });

  it("slugifies names", () => {
    expect(slugify("Season 1 — Génesis Creators")).toBe("season-1-genesis-creators");
    expect(() => slugify("!!!")).toThrow(LeaderboardError);
  });
});

describe("season windows", () => {
  const season = { startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-02-01T00:00:00.000Z" };

  it("uses a half-open window starts_at <= t < ends_at", () => {
    expect(withinSeason("2026-01-01T00:00:00.000Z", season)).toBe(true);
    expect(withinSeason("2026-01-31T23:59:59.000Z", season)).toBe(true);
    expect(withinSeason("2026-02-01T00:00:00.000Z", season)).toBe(false);
    expect(withinSeason("2025-12-31T23:59:59.000Z", season)).toBe(false);
  });

  it("detects overlapping seasons", () => {
    expect(seasonsOverlap(season, { startsAt: "2026-01-15T00:00:00Z", endsAt: "2026-03-01T00:00:00Z" })).toBe(true);
    expect(seasonsOverlap(season, { startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-03-01T00:00:00Z" })).toBe(false);
  });

  it("derives the effective status from the window", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(effectiveSeasonStatus({ status: "active", ...season }, now)).toBe("active");
    expect(effectiveSeasonStatus({ status: "scheduled", ...season }, now)).toBe("scheduled");
    expect(effectiveSeasonStatus({ status: "active", ...season }, Date.parse("2026-03-01T00:00:00Z"))).toBe("ended");
    expect(effectiveSeasonStatus({ status: "draft", ...season }, now)).toBe("draft");
    expect(effectiveSeasonStatus({ status: "archived", ...season }, now)).toBe("archived");
  });

  it("marks ended/archived seasons as immutable", () => {
    expect(isSeasonImmutable("ended")).toBe(true);
    expect(isSeasonImmutable("archived")).toBe(true);
    expect(isSeasonImmutable("active")).toBe(false);
  });

  it("only allows valid status transitions", () => {
    expect(() => assertTransition("draft", "active")).not.toThrow();
    expect(() => assertTransition("active", "ended")).not.toThrow();
    expect(() => assertTransition("ended", "active")).toThrow(LeaderboardError);
    expect(() => assertTransition("archived", "active")).toThrow(LeaderboardError);
  });

  it("computes a countdown that never goes negative", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(countdown("2026-01-03T05:30:00Z", now)).toEqual({ ended: false, days: 2, hours: 5, minutes: 30 });
    expect(countdown("2025-01-01T00:00:00Z", now).ended).toBe(true);
  });
});

describe("snapshot fingerprints", () => {
  it("buckets timestamps so repeated runs are idempotent", () => {
    const a = snapshotBucket(Date.parse("2026-01-01T10:03:00Z"), 15);
    const b = snapshotBucket(Date.parse("2026-01-01T10:14:59Z"), 15);
    const c = snapshotBucket(Date.parse("2026-01-01T10:16:00Z"), 15);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("builds deterministic fingerprint inputs", () => {
    expect(leaderboardFingerprintInput({ chainId: 56, creatorAddress: A.toUpperCase(), snapshotAt: "T" })).toBe(
      `LEADERBOARD|56|${A}|T`,
    );
    expect(seasonFingerprintInput({ chainId: 56, seasonId: "s1", creatorAddress: A, snapshotAt: "T" })).toBe(
      `SEASON|56|s1|${A}|T`,
    );
    expect(seasonFingerprintInput({ chainId: 56, seasonId: "s1", creatorAddress: A, snapshotAt: "T", final: true })).toBe(
      `SEASON|56|s1|${A}|FINAL`,
    );
  });

  it("hashes deterministically", async () => {
    const one = await sha256("SEASON|56|s1|x|T");
    const two = await sha256("SEASON|56|s1|x|T");
    expect(one).toBe(two);
    expect(one).toHaveLength(64);
    expect(one).not.toBe(await sha256("SEASON|56|s1|y|T"));
  });
});

describe("derived metrics", () => {
  it("returns null trending when the creator has no snapshot history", () => {
    expect(trendingMetric({ top5: 0, top10: 0, risingFast: 0, bestRank: null, hasHistory: false })).toBeNull();
  });

  it("dampens repeated snapshots so they cannot inflate the ranking linearly", () => {
    const few = trendingMetric({ top5: 1, top10: 1, risingFast: 0, bestRank: 1, hasHistory: true })!;
    const many = trendingMetric({ top5: 100, top10: 100, risingFast: 0, bestRank: 1, hasHistory: true })!;
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(few * 100);
  });

  it("organic metric distinguishes unavailable from zero", () => {
    expect(organicMetric(null)).toBeNull();
    expect(organicMetric(0)).toBe(0);
    expect(organicMetric(100)!).toBeGreaterThan(0);
  });
});

describe("anti-farming inheritance", () => {
  it("a creator with inflated raw volume but no organic volume cannot outrank an organic creator", () => {
    const farmer = candidate(A, { points: 10, score: 10, graduations: 0, trending: null, organic: organicMetric(0) });
    const organic = candidate(B, { points: 10, score: 10, graduations: 0, trending: null, organic: organicMetric(500) });
    const { scored } = scoreCandidates([farmer, organic]);
    expect(scored[0]!.address).toBe(B);
  });

  it("self/circular trading exclusion means the metric arrives already filtered as 0, not unknown", () => {
    const metric: LeaderboardMetric = "organic";
    const { scored } = scoreCandidates([candidate(A, { organic: 0 }), candidate(B, { organic: 5 })]);
    expect(scored[0]!.components[metric]).toBe(100);
    expect(scored[1]!.components[metric]).toBe(0);
  });
});
