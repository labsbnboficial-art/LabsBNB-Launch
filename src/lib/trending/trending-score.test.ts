import { describe, expect, it } from "vitest";
import type { TradeEvent } from "@/lib/web3/curve-events";
import {
  computeBadges,
  computeMetrics,
  computeTrendingScore,
  computeVelocity,
  explainTrending,
  organicActivityScore,
  windowStats,
} from "./trending-score";
import { applyTrendingQuery } from "./trending-query";
import { DEFAULT_TRENDING_CONFIG, DEFAULT_TRENDING_WEIGHTS, type TrendingRow } from "./trending-types";
import { validateTrendingConfig, TrendingConfigError } from "./trending-config.server";

const NOW = 1_800_000_000;

function trade(opts: Partial<TradeEvent> & { agoSec: number; bnb: number; trader: string; isBuy?: boolean }): TradeEvent {
  return {
    key: `${opts.trader}-${opts.agoSec}-${Math.random()}`,
    txHash: "0xabc",
    trader: opts.trader,
    isBuy: opts.isBuy ?? true,
    amountBnb: BigInt(Math.round(opts.bnb * 1e18)),
    amountTokens: 1n,
    price: 1n,
    marketCap: 1n,
    timestamp: NOW - opts.agoSec,
    blockNumber: 1n,
  } as TradeEvent;
}

const cfg = DEFAULT_TRENDING_CONFIG;
const metricsOf = (events: TradeEvent[], extra: Partial<Parameters<typeof computeMetrics>[0]> = {}) =>
  computeMetrics({ events, now: NOW, holders: null, bondingProgress: null, whaleBnb: cfg.whale_bnb, ...extra });

describe("windowStats", () => {
  it("returns an empty window when there is no activity", () => {
    const s = windowStats([], 900, NOW);
    expect(s).toMatchObject({ volume: 0, trades: 0, buyers: 0, traders: 0 });
  });

  it("aggregates real trades and unique wallets", () => {
    const s = windowStats(
      [
        trade({ agoSec: 60, bnb: 1, trader: "0xa" }),
        trade({ agoSec: 120, bnb: 2, trader: "0xb" }),
        trade({ agoSec: 200, bnb: 1, trader: "0xa", isBuy: false }),
      ],
      900,
      NOW,
      0.5,
    );
    expect(s.trades).toBe(3);
    expect(s.volume).toBeCloseTo(4);
    expect(s.buyers).toBe(2);
    expect(s.sellers).toBe(1);
    expect(s.traders).toBe(2);
    expect(s.whaleTrades).toBe(3);
    expect(s.roundTripShare).toBeCloseTo(0.5); // wallet a bought and sold
  });

  it("ignores trades outside the window", () => {
    const s = windowStats([trade({ agoSec: 5_000, bnb: 10, trader: "0xa" })], 900, NOW);
    expect(s.trades).toBe(0);
  });
});

describe("velocity", () => {
  it("is null without prior history (no invented percentage)", () => {
    const m = metricsOf([trade({ agoSec: 30, bnb: 1, trader: "0xa" })]);
    expect(m.velocityPct).toBeNull();
  });

  it("never divides by zero", () => {
    expect(computeVelocity({ ...windowStats([], 900, NOW) }, { ...windowStats([], 3600, NOW) })).toBeNull();
  });

  it("detects real acceleration", () => {
    const events = [
      trade({ agoSec: 100, bnb: 3, trader: "0xa" }),
      trade({ agoSec: 200, bnb: 3, trader: "0xb" }),
      trade({ agoSec: 2_400, bnb: 1, trader: "0xc" }),
    ];
    const m = metricsOf(events);
    expect(m.velocityPct).not.toBeNull();
    expect(m.velocityPct!).toBeGreaterThan(100);
  });

  it("reports a slowdown as a negative value", () => {
    const events = [
      trade({ agoSec: 800, bnb: 0.01, trader: "0xa" }),
      trade({ agoSec: 2_000, bnb: 5, trader: "0xb" }),
      trade({ agoSec: 2_500, bnb: 5, trader: "0xc" }),
    ];
    expect(metricsOf(events).velocityPct!).toBeLessThan(0);
  });
});

describe("trending score", () => {
  it("is 0 with no activity at all", () => {
    const { score } = computeTrendingScore(metricsOf([]), DEFAULT_TRENDING_WEIGHTS, NOW);
    expect(score).toBe(0);
  });

  it("stays within 0..100 under extreme input", () => {
    const events = Array.from({ length: 400 }, (_, i) =>
      trade({ agoSec: (i % 800) + 1, bnb: 1_000, trader: `0x${i}` }),
    );
    const { score } = computeTrendingScore(
      metricsOf(events, { holders: 100_000, previousHolders: 1, bondingProgress: 100 }),
      DEFAULT_TRENDING_WEIGHTS,
      NOW,
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("does not invent a holders component when holders are unknown", () => {
    const events = [trade({ agoSec: 60, bnb: 1, trader: "0xa" })];
    const { parts } = computeTrendingScore(metricsOf(events), DEFAULT_TRENDING_WEIGHTS, NOW);
    expect(parts.holders).toBeNull();
  });

  it("gives no whale credit when there is no whale activity", () => {
    const events = [trade({ agoSec: 60, bnb: 0.001, trader: "0xa" })];
    const { parts } = computeTrendingScore(metricsOf(events), DEFAULT_TRENDING_WEIGHTS, NOW);
    expect(parts.whales).toBe(0);
  });

  it("ranks distributed buying above one concentrated whale trade", () => {
    const concentrated = [trade({ agoSec: 60, bnb: 50, trader: "0xwhale" })];
    const distributed = Array.from({ length: 8 }, (_, i) =>
      trade({ agoSec: 60 + i * 20, bnb: 1, trader: `0xbuyer${i}` }),
    );
    const a = computeTrendingScore(metricsOf(concentrated), DEFAULT_TRENDING_WEIGHTS, NOW).score;
    const b = computeTrendingScore(metricsOf(distributed), DEFAULT_TRENDING_WEIGHTS, NOW).score;
    expect(b).toBeGreaterThan(a);
  });

  it("penalises wash trading (same wallet buying and selling)", () => {
    const wash = Array.from({ length: 10 }, (_, i) =>
      trade({ agoSec: 60 + i * 10, bnb: 2, trader: "0xwash", isBuy: i % 2 === 0 }),
    );
    expect(organicActivityScore(windowStats(wash, 3600, NOW))).toBeLessThan(30);
  });

  it("rewards near graduation through the bonding component", () => {
    const events = [trade({ agoSec: 60, bnb: 1, trader: "0xa" })];
    const low = computeTrendingScore(metricsOf(events, { bondingProgress: 5 }), DEFAULT_TRENDING_WEIGHTS, NOW).score;
    const high = computeTrendingScore(metricsOf(events, { bondingProgress: 95 }), DEFAULT_TRENDING_WEIGHTS, NOW).score;
    expect(high).toBeGreaterThan(low);
  });
});

describe("badges + explanation", () => {
  it("only emits badges whose real condition holds", () => {
    const m = metricsOf([trade({ agoSec: 60, bnb: 0.001, trader: "0xa" })], { bondingProgress: 10 });
    expect(computeBadges(m, 10, cfg)).toEqual([]);
  });

  it("flags graduation soon at 90%+", () => {
    const m = metricsOf([trade({ agoSec: 60, bnb: 1, trader: "0xa" })], { bondingProgress: 96 });
    const badges = computeBadges(m, 50, cfg);
    expect(badges).toContain("graduation_soon");
    expect(badges).not.toContain("near_graduation");
    expect(badges).toContain("whale_activity");
  });

  it("explains with facts only when there is no activity", () => {
    expect(explainTrending(metricsOf([]))).toMatch(/No on-chain trading activity/);
  });
});

/* ------------------------------- ranking ---------------------------------- */

const row = (over: Partial<TrendingRow>): TrendingRow => ({
  address: "0x1",
  curve: null,
  name: "T",
  symbol: "T",
  logo: null,
  price: null,
  priceChange24h: null,
  volume: 0,
  volumes: { "5m": 0, "15m": 0, "1h": 0, "6h": 0, "24h": 0 },
  trades: 0,
  buyers: 0,
  sellers: 0,
  holders: null,
  bondingProgress: null,
  bondingRemaining: null,
  graduated: false,
  trendingScore: 0,
  velocityScore: null,
  organicScore: 0,
  whaleTrades: 0,
  parts: { momentum: 0, buyers: 0, holders: null, bonding: null, whales: 0, activity: 0 },
  badges: [],
  reason: "",
  lastTradeAt: null,
  rank: 0,
  updatedAt: new Date(NOW * 1000).toISOString(),
  ...over,
});

const q = {
  timeframe: "1h" as const,
  category: "trending" as const,
  stage: "all" as const,
  minTrades: 0,
  limit: 20,
  cursor: 0,
};

describe("ranking", () => {
  it("orders by score and assigns ranks", () => {
    const res = applyTrendingQuery(
      [row({ address: "0xa", trendingScore: 10 }), row({ address: "0xb", trendingScore: 80 })],
      q,
    );
    expect(res.tokens.map((t) => t.address)).toEqual(["0xb", "0xa"]);
    expect(res.tokens[0]!.rank).toBe(1);
  });

  it("breaks ties deterministically", () => {
    const a = applyTrendingQuery([row({ address: "0xa" }), row({ address: "0xb" })], q).tokens.map((t) => t.address);
    const b = applyTrendingQuery([row({ address: "0xb" }), row({ address: "0xa" })], q).tokens.map((t) => t.address);
    expect(a).toEqual(b);
  });

  it("paginates with a cursor", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ address: `0x${i}`, trendingScore: i }));
    const page1 = applyTrendingQuery(rows, { ...q, limit: 2 });
    expect(page1.tokens).toHaveLength(2);
    expect(page1.nextCursor).toBe(2);
    const page2 = applyTrendingQuery(rows, { ...q, limit: 2, cursor: page1.nextCursor! });
    expect(page2.tokens[0]!.address).not.toBe(page1.tokens[0]!.address);
  });

  it("sorts Top Volume by the requested timeframe", () => {
    const rows = [
      row({ address: "0xa", volumes: { "5m": 9, "15m": 0, "1h": 1, "6h": 0, "24h": 0 } }),
      row({ address: "0xb", volumes: { "5m": 1, "15m": 0, "1h": 9, "6h": 0, "24h": 0 } }),
    ];
    expect(applyTrendingQuery(rows, { ...q, category: "volume", timeframe: "5m" }).tokens[0]!.address).toBe("0xa");
    expect(applyTrendingQuery(rows, { ...q, category: "volume", timeframe: "1h" }).tokens[0]!.address).toBe("0xb");
  });

  it("filters by stage and minimum activity", () => {
    const rows = [
      row({ address: "0xa", graduated: true, trades: 50 }),
      row({ address: "0xb", bondingProgress: 90, trades: 1 }),
    ];
    expect(applyTrendingQuery(rows, { ...q, stage: "graduated" }).tokens).toHaveLength(1);
    expect(applyTrendingQuery(rows, { ...q, stage: "near_graduation" }).tokens[0]!.address).toBe("0xb");
    expect(applyTrendingQuery(rows, { ...q, minTrades: 10 }).tokens[0]!.address).toBe("0xa");
  });
});

describe("admin configuration validation", () => {
  it("rejects out-of-range values", () => {
    expect(() => validateTrendingConfig({ scan_tokens: 0 })).toThrow(TrendingConfigError);
    expect(() => validateTrendingConfig({ near_graduation_pct: 900 })).toThrow(TrendingConfigError);
    expect(() => validateTrendingConfig({ whale_bnb: Number.NaN })).toThrow(TrendingConfigError);
  });

  it("rejects a zero total weight", () => {
    expect(() =>
      validateTrendingConfig({ weights: { momentum: 0, buyers: 0, holders: 0, bonding: 0, whales: 0, activity: 0 } }),
    ).toThrow(TrendingConfigError);
  });

  it("keeps valid values", () => {
    const cfgOut = validateTrendingConfig({ scan_interval_min: 5, velocity_threshold: 120 });
    expect(cfgOut.scan_interval_min).toBe(5);
    expect(cfgOut.velocity_threshold).toBe(120);
  });
});
