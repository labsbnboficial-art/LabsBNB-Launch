import { describe, expect, it } from "vitest";
import {
  aggregateStats,
  buildCreatorToken,
  buildTimeline,
  computeCreatorBadges,
  computeCreatorScore,
  normalizeCreatorAddress,
  performanceScore,
  pickBestPerformer,
  sortCreatorTokens,
  tokenStatus,
} from "./creator-score";
import { EMPTY_HISTORY, type CreatorTokenRow, type TokenTrendingHistory } from "./creator-types";
import type { TrendingRow } from "@/lib/trending/trending-types";

const row = (over: Partial<TrendingRow> = {}): TrendingRow => ({
  address: "0x1111111111111111111111111111111111111111",
  curve: null,
  creator: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
  name: "Token",
  symbol: "TKN",
  logo: null,
  price: "0.0001",
  priceChange24h: 3,
  volume: 1,
  volumes: { "5m": 0, "15m": 0.2, "1h": 0.5, "6h": 1, "24h": 2 },
  trades: 12,
  buyers: 6,
  sellers: 3,
  holders: 20,
  bondingProgress: 40,
  bondingRemaining: "1",
  graduated: false,
  trendingScore: 60,
  velocityScore: 10,
  organicScore: 80,
  whaleTrades: 0,
  parts: { momentum: 1, buyers: 1, holders: 1, bonding: 1, whales: null, activity: 1 },
  badges: [],
  reason: "",
  lastTradeAt: null,
  rank: 3,
  updatedAt: new Date().toISOString(),
  ...over,
});

const tokenFrom = (over: Partial<TrendingRow> = {}, hist?: TokenTrendingHistory, createdAt?: string) =>
  buildCreatorToken(row(over), hist ?? EMPTY_HISTORY, { createdAt: createdAt ?? null, graduatedAt: null });

const statsOf = (tokens: CreatorTokenRow[], hist = new Map<string, TokenTrendingHistory>()) =>
  aggregateStats(tokens, hist);

describe("creator address normalization", () => {
  it("lowercases checksum addresses", () => {
    expect(normalizeCreatorAddress("0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa")).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
  it("rejects junk, the zero address and non-strings", () => {
    expect(normalizeCreatorAddress("0x123")).toBeNull();
    expect(normalizeCreatorAddress(`0x${"0".repeat(40)}`)).toBeNull();
    expect(normalizeCreatorAddress(null)).toBeNull();
    expect(normalizeCreatorAddress(42)).toBeNull();
  });
});

describe("creator aggregation", () => {
  it("sums real metrics across tokens and counts statuses", () => {
    const tokens = [
      tokenFrom({ address: "0xa".padEnd(42, "1"), graduated: true, bondingProgress: 100 }),
      tokenFrom({ address: "0xb".padEnd(42, "2"), trades: 0, buyers: 0, holders: 1, volumes: { "5m": 0, "15m": 0, "1h": 0, "6h": 0, "24h": 0 } }),
    ];
    const s = statsOf(tokens);
    expect(s.tokensCreated).toBe(2);
    expect(s.graduatedTokens).toBe(1);
    expect(s.idleTokens).toBe(1);
    expect(s.trades24h).toBe(12);
    expect(s.volume24h).toBeCloseTo(2);
  });

  it("keeps holders null when no token reports holders", () => {
    const s = statsOf([tokenFrom({ holders: null })]);
    expect(s.holders).toBeNull();
  });

  it("detects graduated tokens and near graduation status", () => {
    expect(tokenStatus({ graduated: true, bondingProgress: 100, trades24h: 0, holders: null })).toBe("graduated");
    expect(tokenStatus({ graduated: false, bondingProgress: 85, trades24h: 0, holders: null })).toBe("near_graduation");
    expect(tokenStatus({ graduated: false, bondingProgress: 10, trades24h: 3, holders: null })).toBe("active");
    expect(tokenStatus({ graduated: false, bondingProgress: 0, trades24h: 0, holders: 1 })).toBe("idle");
  });
});

describe("creator score", () => {
  it("stays inside 0..100 and is deterministic", () => {
    const tokens = [tokenFrom()];
    const a = computeCreatorScore(statsOf(tokens), tokens);
    const b = computeCreatorScore(statsOf(tokens), tokens);
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });

  it("rewards quality over quantity: 3 tokens with 2 graduations beat 50 empty ones", () => {
    const quality = [
      tokenFrom({ address: "0xq1".padEnd(42, "1"), graduated: true, bondingProgress: 100 }),
      tokenFrom({ address: "0xq2".padEnd(42, "2"), graduated: true, bondingProgress: 100 }),
      tokenFrom({ address: "0xq3".padEnd(42, "3"), bondingProgress: 60 }),
    ];
    const spam = Array.from({ length: 50 }, (_, i) =>
      tokenFrom({
        address: `0x${String(i).padStart(40, "0")}`,
        trades: 0,
        buyers: 0,
        holders: 0,
        bondingProgress: 0,
        organicScore: 0,
        volumes: { "5m": 0, "15m": 0, "1h": 0, "6h": 0, "24h": 0 },
      }),
    );
    const q = computeCreatorScore(statsOf(quality), quality).score;
    const s = computeCreatorScore(statsOf(spam), spam).score;
    expect(q).toBeGreaterThan(s);
  });

  it("redistributes weight when trending, holders and whale data are missing", () => {
    const tokens = [tokenFrom({ holders: null, rank: 0, whaleTrades: 0 })];
    const { parts, score } = computeCreatorScore(statsOf(tokens), tokens);
    expect(parts.trendingPerformance).toBeNull();
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 with no tokens at all", () => {
    const { score, parts } = computeCreatorScore(statsOf([]), []);
    expect(score).toBe(0);
    expect(parts.launchQuality).toBeNull();
  });
});

describe("anti-gaming", () => {
  it("penalises a single-wallet, wash-like creator (low organic score)", () => {
    const organic = [tokenFrom({ organicScore: 90, buyers: 12 })];
    const washed = [tokenFrom({ organicScore: 5, buyers: 1 })];
    expect(computeCreatorScore(statsOf(organic), organic).score).toBeGreaterThan(
      computeCreatorScore(statsOf(washed), washed).score,
    );
  });

  it("does not let one huge artificial volume max the score", () => {
    const huge = [
      tokenFrom({
        organicScore: 10,
        buyers: 1,
        volumes: { "5m": 0, "15m": 0, "1h": 500, "6h": 500, "24h": 5000 },
      }),
    ];
    expect(computeCreatorScore(statsOf(huge), huge).score).toBeLessThan(60);
  });
});

describe("badges", () => {
  const now = Date.parse("2026-09-05T00:00:00.000Z");

  it("gives 🆕 New Creator to a recent, small creator", () => {
    const tokens = [tokenFrom({}, EMPTY_HISTORY, "2026-09-01T00:00:00.000Z")];
    expect(computeCreatorBadges(statsOf(tokens), tokens, now)).toContain("new_creator");
  });

  it("gives 🔥 Trending Creator only with a real Top 5 placement", () => {
    const hist = new Map<string, TokenTrendingHistory>();
    const t = tokenFrom({ rank: 4 }, { ...EMPTY_HISTORY, bestRank: 4, top5: 2 });
    hist.set(t.address.toLowerCase(), { ...EMPTY_HISTORY, bestRank: 4, top5: 2 });
    expect(computeCreatorBadges(statsOf([t], hist), [t], now)).toContain("trending_creator");

    const weak = tokenFrom({ rank: 12 }, { ...EMPTY_HISTORY, bestRank: 12 });
    expect(computeCreatorBadges(statsOf([weak]), [weak], now)).not.toContain("trending_creator");
  });

  it("gives graduator / multi graduator from real graduations", () => {
    const one = [tokenFrom({ graduated: true, bondingProgress: 100 })];
    expect(computeCreatorBadges(statsOf(one), one, now)).toContain("graduator");
    const two = [
      tokenFrom({ address: "0xg1".padEnd(42, "1"), graduated: true, bondingProgress: 100 }),
      tokenFrom({ address: "0xg2".padEnd(42, "2"), graduated: true, bondingProgress: 100 }),
    ];
    expect(computeCreatorBadges(statsOf(two), two, now)).toContain("multi_graduator");
  });

  it("does not award whale magnet or community builder without real data", () => {
    const tokens = [tokenFrom({ whaleTrades: 0, holders: 2, buyers: 1 })];
    const badges = computeCreatorBadges(statsOf(tokens), tokens, now);
    expect(badges).not.toContain("whale_magnet");
    expect(badges).not.toContain("community_builder");
  });
});

describe("best performer + ordering", () => {
  it("does not pick by price alone", () => {
    const cheapButStrong = tokenFrom({
      address: "0xs".padEnd(42, "1"),
      price: "0.00000001",
      graduated: true,
      bondingProgress: 100,
      holders: 120,
    });
    const expensiveButDead = tokenFrom({
      address: "0xd".padEnd(42, "2"),
      price: "10",
      trades: 0,
      buyers: 0,
      holders: 1,
      bondingProgress: 1,
      organicScore: 0,
      volumes: { "5m": 0, "15m": 0, "1h": 0, "6h": 0, "24h": 0 },
    });
    expect(pickBestPerformer([expensiveButDead, cheapButStrong])?.address).toBe(cheapButStrong.address);
  });

  it("orders active before graduated before idle", () => {
    const active = tokenFrom({ address: "0xa".padEnd(42, "1") });
    const graduated = tokenFrom({ address: "0xb".padEnd(42, "2"), graduated: true, bondingProgress: 100 });
    const idle = tokenFrom({
      address: "0xc".padEnd(42, "3"),
      trades: 0,
      buyers: 0,
      holders: 0,
      volumes: { "5m": 0, "15m": 0, "1h": 0, "6h": 0, "24h": 0 },
    });
    const sorted = sortCreatorTokens([idle, graduated, active]);
    expect(sorted.map((t) => t.status)).toEqual(["active", "graduated", "idle"]);
  });

  it("performance stays within 0..1", () => {
    const p = performanceScore({
      volume24h: 1e9,
      organicScore: 100,
      holders: 1e6,
      bondingProgress: 100,
      graduated: true,
      bestTrendingRank: 1,
    });
    expect(p).toBeLessThanOrEqual(1);
    expect(p).toBeGreaterThan(0.9);
  });
});

describe("timeline", () => {
  it("only contains real dated events, newest first", () => {
    const t = tokenFrom({}, EMPTY_HISTORY, "2026-09-01T00:00:00.000Z");
    const hist = new Map<string, TokenTrendingHistory>([
      [
        t.address.toLowerCase(),
        {
          ...EMPTY_HISTORY,
          events: [
            { kind: "trending_top5", at: "2026-09-03T00:00:00.000Z", token: t.address, symbol: "TKN", detail: "#3" },
          ],
        },
      ],
    ]);
    const timeline = buildTimeline([t], hist);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.kind).toBe("trending_top5");
    expect(timeline[1]!.kind).toBe("token_created");
  });

  it("is empty when no real dates exist", () => {
    expect(buildTimeline([tokenFrom()], new Map())).toHaveLength(0);
  });
});
