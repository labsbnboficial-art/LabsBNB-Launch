// 🏆 Fase 2C.1 — Creator Level History rules (pure, deterministic).
import { describe, expect, it } from "vitest";
import {
  detectMissingLevelMilestones,
  expectedMilestoneLevels,
  fingerprint,
  fingerprintInput,
  LevelHistoryError,
  milestoneKey,
  normalizeAddress,
} from "./level-history-rules";
import { DEFAULT_LEVELS_CONFIG, type CreatorLevelsConfig } from "./levels-types";

const A = "0x1c1098b5ea18e20d959d650617e0268522d25493";
const chainId = 56;

const detect = (totalPoints: number, existingLevels: number[] = [], config?: CreatorLevelsConfig, backfill = false) =>
  detectMissingLevelMilestones({
    chainId,
    creatorAddress: A,
    totalPoints,
    existingLevels,
    ...(config ? { config } : {}),
    backfill,
  });

describe("expected milestones", () => {
  it("Test 1 — 0 points: level 1, no milestone", async () => {
    expect(expectedMilestoneLevels(0, DEFAULT_LEVELS_CONFIG)).toEqual([]);
    expect(await detect(0)).toHaveLength(0);
  });

  it("Test 2 — exactly 500 points: level 2 milestone", async () => {
    const m = await detect(500);
    expect(m.map((x) => x.newLevel)).toEqual([2]);
    expect(m[0]!.previousLevel).toBe(1);
    expect(m[0]!.pointsAtLevelUp).toBe(500);
    expect(m[0]!.milestoneKey).toBe("creator_level_2");
  });

  it("Test 3 — 1,999 points stays at level 2", () => {
    expect(expectedMilestoneLevels(1_999)).toEqual([2]);
  });

  it("Test 4 — 2,000 points reaches level 3", () => {
    expect(expectedMilestoneLevels(2_000)).toEqual([2, 3]);
  });

  it("Test 5 — 5,000 points reaches level 4", () => {
    expect(expectedMilestoneLevels(5_000)).toEqual([2, 3, 4]);
  });

  it("Test 6 — 150,000 points reaches level 7", () => {
    expect(expectedMilestoneLevels(150_000)).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe("idempotency and concurrency", () => {
  it("Test 7 — running the detector 10 times yields one milestone per level", async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10; i += 1) {
      const missing = await detect(2_500, [...seen]);
      for (const m of missing) seen.add(m.newLevel);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("Test 9 — two concurrent runs produce identical fingerprints (unique index dedupes)", async () => {
    const [a, b] = await Promise.all([detect(2_500), detect(2_500)]);
    expect(a.map((m) => m.fingerprint)).toEqual(b.map((m) => m.fingerprint));
    expect(new Set(a.map((m) => m.fingerprint)).size).toBe(a.length);
  });

  it("fingerprint is deterministic sha256 of a stable input", async () => {
    expect(fingerprintInput({ chainId, creatorAddress: A.toUpperCase(), newLevel: 3 })).toBe(
      `LEVEL_UP|56|${A}|3|creator_level_3`,
    );
    const f = await fingerprint({ chainId, creatorAddress: A, newLevel: 3 });
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).toBe(await fingerprint({ chainId, creatorAddress: A.toUpperCase(), newLevel: 3 }));
  });
});

describe("multi-level jump", () => {
  it("Test 8 — 500 → 15,000 creates levels 3, 4 and 5 in order", async () => {
    const m = await detect(15_000, [2]);
    expect(m.map((x) => x.newLevel)).toEqual([3, 4, 5]);
    expect(m.map((x) => x.previousLevel)).toEqual([2, 3, 4]);
    // intermediate levels record their threshold; the top one the real total
    expect(m[0]!.pointsAtLevelUp).toBe(2_000);
    expect(m[1]!.pointsAtLevelUp).toBe(5_000);
    expect(m[2]!.pointsAtLevelUp).toBe(15_000);
    expect(new Set(m.map((x) => x.fingerprint)).size).toBe(3);
  });
});

describe("backfill", () => {
  it("Test 10 — rebuilds only missing milestones and marks them", async () => {
    const m = await detect(12_000, [2, 3], undefined, true);
    expect(m.map((x) => x.newLevel)).toEqual([4]);
    expect(m[0]!.metadata["backfill"]).toBe(true);
    expect(m[0]!.metadata["reason"]).toBe("initial_level_history_migration");
  });

  it("live runs are not marked as backfill", async () => {
    const m = await detect(600);
    expect(m[0]!.metadata["backfill"]).toBe(false);
  });
});

describe("configuration changes and level-down", () => {
  const harder: CreatorLevelsConfig = {
    enabled: true,
    levels: DEFAULT_LEVELS_CONFIG.levels.map((l) => (l.level === 2 ? { ...l, minPoints: 5_000 } : l)),
  };

  it("Test 11 — raising a threshold never asks to remove existing history", async () => {
    // creator already has level 2 recorded; new config puts him back at level 1
    const m = await detect(1_000, [2], harder);
    expect(m).toHaveLength(0); // nothing added, nothing removed
  });

  it("Test 12 — level-down produces no delete instruction, history is append-only", async () => {
    const m = await detect(0, [2, 3]);
    expect(m).toHaveLength(0);
  });
});

describe("security and normalization", () => {
  it("Test 14 — invalid addresses are rejected", async () => {
    expect(() => normalizeAddress("nope")).toThrow(LevelHistoryError);
    expect(() => normalizeAddress("0x123")).toThrow(LevelHistoryError);
    await expect(
      detectMissingLevelMilestones({ chainId, creatorAddress: "0x123", totalPoints: 500, existingLevels: [] }),
    ).rejects.toThrow(LevelHistoryError);
  });

  it("Test 15 — case normalization: 0xABC and 0xabc are the same creator", async () => {
    expect(normalizeAddress(A.toUpperCase().replace("0X", "0x"))).toBe(A);
    const upper = await detectMissingLevelMilestones({
      chainId,
      creatorAddress: A.toUpperCase().replace("0X", "0x"),
      totalPoints: 500,
      existingLevels: [],
    });
    const lower = await detect(500);
    expect(upper[0]!.fingerprint).toBe(lower[0]!.fingerprint);
    expect(upper[0]!.creatorAddress).toBe(A);
  });

  it("milestone keys are stable and independent of thresholds", () => {
    expect(milestoneKey(4)).toBe("creator_level_4");
  });

  it("Test 13 — milestones only carry server-derived data (no client fields)", async () => {
    const m = await detect(500);
    expect(Object.keys(m[0]!).sort()).toEqual(
      [
        "chainId",
        "creatorAddress",
        "fingerprint",
        "metadata",
        "milestoneKey",
        "newLevel",
        "pointsAtLevelUp",
        "previousLevel",
        "source",
      ].sort(),
    );
    expect(m[0]!.source).toBe("creator_points");
  });
});
