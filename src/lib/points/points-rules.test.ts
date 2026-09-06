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
    expect(milestonesReached(12, [10, 25, 50])).toEqual([10]);
    expect(milestonesReached(50, [10, 25, 50])).toEqual([10, 25, 50]);
    expect(milestonesReached(0, [10, 25, 50])).toEqual([]);
  });
});

describe("idempotency", () => {
  it("produces a stable fingerprint for the same fact", async () => {
    const input = fingerprintInput(56, "0xAbC", "TOKEN_CREATED", "src-1", "0xToken");
    const a = await fingerprint(input);
    const b = await fingerprint(fingerprintInput(56, "0xabc", "TOKEN_CREATED", "src-1", "0xtoken"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when any component changes", async () => {
    const a = await fingerprint(fingerprintInput(56, "0xa", "TOKEN_CREATED", "s", "0xt"));
    const b = await fingerprint(fingerprintInput(56, "0xa", "GRADUATED", "s", "0xt"));
    expect(a).not.toBe(b);
  });
});

describe("anti-farming trade aggregation", () => {
  const creator = "0xcreator0000000000000000000000000000cafe";
  const base = { at: "2026-01-01T00:00:00.000Z", bnb: 1 };

  it("ignores trades made by the creator itself", () => {
    const agg = aggregateTrades(
      [
        { ...base, trader: creator, isBuy: true },
        { ...base, trader: "0xbuyer1", isBuy: true },
      ],
      creator,
    );
    expect(agg.uniqueBuyers).toBe(1);
    expect(agg.selfTrades).toBe(1);
  });

  it("discounts instant round-trips (wash trading)", () => {
    const agg = aggregateTrades(
      [
        { at: "2026-01-01T00:00:00.000Z", trader: "0xwash", isBuy: true, bnb: 5 },
        { at: "2026-01-01T00:00:30.000Z", trader: "0xwash", isBuy: false, bnb: 5 },
      ],
      creator,
    );
    expect(agg.roundTrips).toBeGreaterThan(0);
    expect(agg.organicVolume).toBeLessThan(agg.volume);
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
