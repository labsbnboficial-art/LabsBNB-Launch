// Creator Points — deterministic rules, anti-farming and idempotency.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aggregateTrades,
  applyMultiplier,
  fingerprint,
  fingerprintInput,
  milestonesReached,
  organicMultiplier,
  utcDayKey,
  validatePointsConfig,
} from "./points-rules";
import { DEFAULT_POINTS_CONFIG } from "./points-types";
import * as pointsFns from "@/lib/points.functions";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("organic multiplier", () => {
  it("kills points for clearly inorganic activity", () => {
    expect(organicMultiplier(0)).toBe(0);
    expect(organicMultiplier(29)).toBe(0);
  });

  it("scales monotonically with the organic score", () => {
    const scores = [30, 50, 70, 85, 95, 100];
    const values = scores.map(organicMultiplier);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(organicMultiplier(100)).toBe(1.25);
  });

  it("never awards more than the multiplied base", () => {
    expect(applyMultiplier(100, 0)).toBe(0);
    expect(applyMultiplier(100, 1.25)).toBe(125);
  });
});

describe("milestones", () => {
  it("returns only the thresholds actually reached", () => {
    const pts = [100, 250, 500];
    expect(milestonesReached([10, 25, 50], pts, 12).map((m) => m.threshold)).toEqual([10]);
    expect(milestonesReached([10, 25, 50], pts, 50).map((m) => m.points)).toEqual(pts);
    expect(milestonesReached([10, 25, 50], pts, 0)).toEqual([]);
    expect(milestonesReached([10, 25, 50], pts, null)).toEqual([]);
  });
});

describe("idempotency", () => {
  it("produces a stable fingerprint for the same fact", async () => {
    const a = await fingerprint({
      chainId: 56,
      creatorAddress: "0xAbC",
      eventType: "TOKEN_CREATED",
      sourceId: "src-1",
      tokenAddress: "0xToken",
    });
    const b = await fingerprint({
      chainId: 56,
      creatorAddress: "0xabc",
      eventType: "TOKEN_CREATED",
      sourceId: "src-1",
      tokenAddress: "0xtoken",
    });
    expect(a).toBe(b);
    expect(fingerprintInput({
      chainId: 56,
      creatorAddress: "0xABC",
      eventType: "TOKEN_CREATED",
      sourceId: "src-1",
      tokenAddress: null,
    })).toContain("0xabc");
    expect(a).toHaveLength(64);
  });

  it("changes when any component changes", async () => {
    const base = { chainId: 56, creatorAddress: "0xa", sourceId: "s", tokenAddress: "0xt" } as const;
    const a = await fingerprint({ ...base, eventType: "TOKEN_CREATED" });
    const b = await fingerprint({ ...base, eventType: "GRADUATED" });
    expect(a).not.toBe(b);
  });
});

describe("anti-farming trade aggregation", () => {
  const creator = "0xcreator0000000000000000000000000000cafe";
  const one = 10n ** 18n;

  it("ignores trades made by the creator itself", () => {
    const agg = aggregateTrades(
      [
        { trader: creator, isBuy: true, amountBnb: one },
        { trader: "0xbuyer1", isBuy: true, amountBnb: one },
      ] as never,
      creator,
    );
    expect(agg.uniqueBuyers).toBe(1);
    expect(agg.selfTrades).toBe(1);
    expect(agg.selfVolume).toBeCloseTo(1);
  });

  it("discounts round-trips (wash trading) from the organic volume", () => {
    const agg = aggregateTrades(
      [
        { trader: "0xwash", isBuy: true, amountBnb: 5n * one },
        { trader: "0xwash", isBuy: false, amountBnb: 5n * one },
      ] as never,
      creator,
    );
    expect(agg.roundTripShare).toBeGreaterThan(0);
    expect(agg.organicVolume).toBe(0);
    expect(agg.suspicious).toBe(true);
  });
});

describe("config validation", () => {
  it("accepts the defaults", () => {
    expect(validatePointsConfig(DEFAULT_POINTS_CONFIG, DEFAULT_POINTS_CONFIG)).toBeTruthy();
  });

  it("rejects negative point values", () => {
    const bad = {
      ...DEFAULT_POINTS_CONFIG,
      events: {
        ...DEFAULT_POINTS_CONFIG.events,
        TOKEN_CREATED: { ...DEFAULT_POINTS_CONFIG.events.TOKEN_CREATED, base_points: -5 },
      },
    };
    expect(() => validatePointsConfig(bad, DEFAULT_POINTS_CONFIG)).toThrow();
  });

  it("keeps day keys in UTC", () => {
    expect(utcDayKey(new Date("2026-01-01T23:59:59.000Z"))).toBe("2026-01-01");
  });
});

describe("security surface", () => {
  it("exposes no client-callable ledger mutation", () => {
    expect(Object.keys(pointsFns).sort()).toEqual([
      "getCreatorPoints",
      "getCreatorPointsHistory",
      "getPointsOverview",
      "historySchema",
      "runPointsEngine",
      "savePointsConfig",
    ]);
  });

  it("never updates or deletes ledger rows", () => {
    for (const f of ["src/lib/points/points-store.server.ts", "src/lib/points/points-engine.server.ts"]) {
      expect(read(f)).not.toMatch(/\.(update|delete)\(/);
    }
  });

  it("scopes every read to the active mainnet chain", () => {
    const store = read("src/lib/points/points-store.server.ts");
    expect((store.match(/chain_id/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
