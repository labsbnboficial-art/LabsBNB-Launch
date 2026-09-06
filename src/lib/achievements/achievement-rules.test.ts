import { describe, expect, it } from "vitest";
import {
  AchievementError,
  evaluateAchievementRule,
  evaluateCreatorContext,
  fingerprint,
  fingerprintInput,
  normalizeAddress,
  validateAchievementsConfig,
  type AchievementContext,
  type AchievementTokenFacts,
} from "./achievement-rules";
import { DEFAULT_ACHIEVEMENTS_CONFIG, type AchievementsConfig } from "./achievement-types";

const A = "0x1c1098b5EA18E20d959d650617e0268522D25493";
const T = "0xF0fDbF6fCa4FDBe9A6533C56AAa26feC68E85988";

const token = (over: Partial<AchievementTokenFacts> = {}): AchievementTokenFacts => ({
  address: T.toLowerCase(),
  symbol: "LABS",
  createdAt: "2026-01-01T00:00:00.000Z",
  holders: null,
  bondingProgress: null,
  graduated: false,
  graduatedAt: null,
  bestTrendingRank: null,
  bestTrendingScore: null,
  top5Appearances: 0,
  nearGraduationAt: null,
  organicScore: 80,
  whaleTrades: 0,
  buyers: 0,
  creationTx: null,
  creationBlock: null,
  ...over,
});

const ctx = (over: Partial<AchievementContext> = {}): AchievementContext => ({
  chainId: 56,
  creatorAddress: A.toLowerCase(),
  tokens: [token()],
  creatorLevel: 1,
  levelMilestones: [],
  unlockedKeys: new Set<string>(),
  ...over,
});

const cfg = (mutate: (c: AchievementsConfig) => void): AchievementsConfig => {
  const clone = JSON.parse(JSON.stringify(DEFAULT_ACHIEVEMENTS_CONFIG)) as AchievementsConfig;
  mutate(clone);
  return clone;
};

describe("address normalization + fingerprint", () => {
  it("normalizes case", () => {
    expect(normalizeAddress(A)).toBe(A.toLowerCase());
  });

  it("rejects an invalid address", () => {
    expect(() => normalizeAddress("0x123")).toThrow(AchievementError);
    expect(() => normalizeAddress("")).toThrow(AchievementError);
  });

  it("is deterministic and case-insensitive", async () => {
    const a = await fingerprint({ chainId: 56, creatorAddress: A, achievementKey: "graduator", sourceId: T });
    const b = await fingerprint({
      chainId: 56,
      creatorAddress: A.toLowerCase(),
      achievementKey: "graduator",
      sourceId: T.toLowerCase(),
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes with the chain, the creator, the key or the source", () => {
    const base = { chainId: 56, creatorAddress: A, achievementKey: "graduator", sourceId: T };
    expect(fingerprintInput(base)).not.toBe(fingerprintInput({ ...base, chainId: 97 }));
    expect(fingerprintInput(base)).not.toBe(fingerprintInput({ ...base, achievementKey: "multi_graduator" }));
    expect(fingerprintInput(base)).not.toBe(fingerprintInput({ ...base, sourceId: null }));
  });
});

describe("first_launch", () => {
  it("unlocks with a real creation timestamp", () => {
    const r = evaluateAchievementRule("first_launch", ctx());
    expect(r.unlocked).toBe(true);
    expect(r.evidence?.["tokenAddress"]).toBe(T.toLowerCase());
  });

  it("does not unlock without verifiable timestamps", () => {
    const r = evaluateAchievementRule("first_launch", ctx({ tokens: [token({ createdAt: null })] }));
    expect(r.unlocked).toBe(false);
  });

  it("does not unlock with no tokens", () => {
    expect(evaluateAchievementRule("first_launch", ctx({ tokens: [] })).unlocked).toBe(false);
  });
});

describe("community_starter / community_builder", () => {
  it("unlocks at exactly the configured holders", () => {
    expect(evaluateAchievementRule("community_starter", ctx({ tokens: [token({ holders: 10 })] })).unlocked).toBe(true);
  });

  it("stays locked below the threshold and reports progress", () => {
    const r = evaluateAchievementRule("community_starter", ctx({ tokens: [token({ holders: 9 })] }));
    expect(r.unlocked).toBe(false);
    expect(r.progress).toEqual({ current: 9, target: 10, label: "holders reales" });
  });

  it("never unlocks when holders are not measurable (no fake data)", () => {
    const r = evaluateAchievementRule("community_starter", ctx({ tokens: [token({ holders: null })] }));
    expect(r.unlocked).toBe(false);
    expect(r.progress).toBeNull();
  });

  it("community_builder requires organic activity and buyer diversity", () => {
    const farmed = ctx({ tokens: [token({ holders: 60, organicScore: 20, buyers: 40 })] });
    expect(evaluateAchievementRule("community_builder", farmed).unlocked).toBe(false);
    const thin = ctx({ tokens: [token({ holders: 60, organicScore: 90, buyers: 2 })] });
    expect(evaluateAchievementRule("community_builder", thin).unlocked).toBe(false);
    const real = ctx({ tokens: [token({ holders: 60, organicScore: 90, buyers: 30 })] });
    expect(evaluateAchievementRule("community_builder", real).unlocked).toBe(true);
  });
});

describe("trending achievements", () => {
  it("trending_creator unlocks with a Top 5 rank", () => {
    expect(evaluateAchievementRule("trending_creator", ctx({ tokens: [token({ bestTrendingRank: 3 })] })).unlocked).toBe(
      true,
    );
    expect(evaluateAchievementRule("trending_creator", ctx({ tokens: [token({ bestTrendingRank: 7 })] })).unlocked).toBe(
      false,
    );
  });

  it("trending_master counts deduplicated Top 5 appearances across tokens", () => {
    const c = ctx({ tokens: [token({ top5Appearances: 2 }), token({ address: "0xabc", top5Appearances: 1 })] });
    const r = evaluateAchievementRule("trending_master", c);
    expect(r.unlocked).toBe(true);
    expect(r.evidence?.["value"]).toBe(3);
  });

  it("trending_master respects an admin threshold change", () => {
    const c = ctx({ tokens: [token({ top5Appearances: 3 })] });
    const stricter = cfg((x) => {
      x.definitions.find((d) => d.key === "trending_master")!.ruleConfig["appearances"] = 10;
    });
    expect(evaluateAchievementRule("trending_master", c, stricter).unlocked).toBe(false);
  });
});

describe("speed_runner", () => {
  it("unlocks only with both real timestamps inside the window", () => {
    const fast = token({
      createdAt: "2026-01-01T00:00:00.000Z",
      nearGraduationAt: "2026-01-01T10:00:00.000Z",
      bondingProgress: 85,
    });
    expect(evaluateAchievementRule("speed_runner", ctx({ tokens: [fast] })).unlocked).toBe(true);
  });

  it("stays locked when it took longer than configured", () => {
    const slow = token({ createdAt: "2026-01-01T00:00:00.000Z", nearGraduationAt: "2026-01-05T00:00:00.000Z" });
    expect(evaluateAchievementRule("speed_runner", ctx({ tokens: [slow] })).unlocked).toBe(false);
  });

  it("stays locked when timestamps are missing", () => {
    const r = evaluateAchievementRule("speed_runner", ctx({ tokens: [token({ nearGraduationAt: null })] }));
    expect(r.unlocked).toBe(false);
    expect(r.reason).toMatch(/timestamps/i);
  });
});

describe("graduation achievements", () => {
  it("graduator unlocks with one graduated token", () => {
    expect(evaluateAchievementRule("graduator", ctx({ tokens: [token({ graduated: true })] })).unlocked).toBe(true);
    expect(evaluateAchievementRule("graduator", ctx()).unlocked).toBe(false);
  });

  it("multi_graduator counts unique tokens only", () => {
    const dup = ctx({ tokens: [token({ graduated: true }), token({ graduated: true })] });
    expect(evaluateAchievementRule("multi_graduator", dup).unlocked).toBe(false);
    const three = ctx({
      tokens: [
        token({ address: "0x1", graduated: true }),
        token({ address: "0x2", graduated: true }),
        token({ address: "0x3", graduated: true }),
      ],
    });
    expect(evaluateAchievementRule("multi_graduator", three).unlocked).toBe(true);
  });
});

describe("whale_magnet anti-farming", () => {
  it("unlocks with organic whale activity and diverse wallets", () => {
    const c = ctx({ tokens: [token({ whaleTrades: 3, organicScore: 75, buyers: 12 })] });
    expect(evaluateAchievementRule("whale_magnet", c).unlocked).toBe(true);
  });

  it("never unlocks with circular / manipulated trading", () => {
    const c = ctx({ tokens: [token({ whaleTrades: 20, organicScore: 10, buyers: 40 })] });
    const r = evaluateAchievementRule("whale_magnet", c);
    expect(r.unlocked).toBe(false);
    expect(r.reason).toMatch(/manipulativa/i);
  });

  it("never unlocks with a single wallet self-trading", () => {
    const c = ctx({ tokens: [token({ whaleTrades: 9, organicScore: 95, buyers: 1 })] });
    expect(evaluateAchievementRule("whale_magnet", c).unlocked).toBe(false);
  });
});

describe("creator_legend (composite)", () => {
  const legendCtx = (over: Partial<AchievementContext> = {}) =>
    ctx({
      creatorLevel: 7,
      unlockedKeys: new Set(["graduator", "multi_graduator", "trending_master"]),
      ...over,
    });

  it("unlocks with max level and every requirement", () => {
    expect(evaluateAchievementRule("creator_legend", legendCtx()).unlocked).toBe(true);
  });

  it("stays locked below the required level", () => {
    expect(evaluateAchievementRule("creator_legend", legendCtx({ creatorLevel: 5 })).unlocked).toBe(false);
  });

  it("stays locked with a missing requirement", () => {
    const c = legendCtx({ unlockedKeys: new Set(["graduator"]) });
    expect(evaluateAchievementRule("creator_legend", c).unlocked).toBe(false);
  });
});

describe("catalog evaluation", () => {
  const rich = ctx({
    tokens: [token({ holders: 80, graduated: true, graduatedAt: "2026-02-01T00:00:00.000Z", top5Appearances: 4, buyers: 30 })],
    creatorLevel: 7,
  });

  it("is idempotent: 10 runs produce the same candidates", async () => {
    const runs = await Promise.all(Array.from({ length: 10 }, () => evaluateCreatorContext(rich)));
    const first = runs[0]!.candidates.map((c) => c.fingerprint).sort();
    for (const r of runs) expect(r.candidates.map((c) => c.fingerprint).sort()).toEqual(first);
  });

  it("never re-emits an already unlocked achievement", async () => {
    const { candidates } = await evaluateCreatorContext(rich);
    const keys = new Set(candidates.map((c) => c.achievementKey));
    const second = await evaluateCreatorContext({ ...rich, unlockedKeys: keys });
    expect(second.candidates).toHaveLength(0);
  });

  it("awards zero Creator Points (no points field exists)", async () => {
    const { candidates } = await evaluateCreatorContext(rich);
    for (const c of candidates) expect(Object.keys(c)).not.toContain("points");
  });

  it("attaches verifiable evidence to every unlock", async () => {
    const { candidates } = await evaluateCreatorContext(rich);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) expect(Object.keys(c.evidence).length).toBeGreaterThan(0);
  });

  it("marks backfill runs in the metadata", async () => {
    const { candidates } = await evaluateCreatorContext(rich, DEFAULT_ACHIEVEMENTS_CONFIG, { backfill: true });
    for (const c of candidates) expect(c.metadata["backfill"]).toBe(true);
  });

  it("emits nothing when the engine is disabled", async () => {
    const off = cfg((x) => {
      x.enabled = false;
    });
    expect((await evaluateCreatorContext(rich, off)).candidates).toHaveLength(0);
  });

  it("skips a disabled achievement", async () => {
    const off = cfg((x) => {
      x.definitions.find((d) => d.key === "graduator")!.enabled = false;
    });
    const { candidates } = await evaluateCreatorContext(rich, off);
    expect(candidates.some((c) => c.achievementKey === "graduator")).toBe(false);
  });

  it("normalizes the creator address in every candidate", async () => {
    const { candidates } = await evaluateCreatorContext({ ...rich, creatorAddress: A });
    for (const c of candidates) expect(c.creatorAddress).toBe(A.toLowerCase());
  });

  it("rejects an invalid creator address", async () => {
    await expect(evaluateCreatorContext({ ...rich, creatorAddress: "nope" })).rejects.toThrow(AchievementError);
  });

  it("a creator with no measurable data unlocks nothing beyond the launch", async () => {
    const empty = ctx({ tokens: [token({ createdAt: null })], creatorLevel: 1 });
    expect((await evaluateCreatorContext(empty)).candidates).toHaveLength(0);
  });
});

describe("configuration validation", () => {
  it("accepts the default configuration", () => {
    expect(validateAchievementsConfig(DEFAULT_ACHIEVEMENTS_CONFIG).definitions).toHaveLength(10);
  });

  it("rejects unknown keys, duplicates and bad thresholds", () => {
    expect(() =>
      validateAchievementsConfig({ enabled: true, definitions: [{ ...DEFAULT_ACHIEVEMENTS_CONFIG.definitions[0], key: "hacker" }] }),
    ).toThrow(AchievementError);
    const dup = [DEFAULT_ACHIEVEMENTS_CONFIG.definitions[0], DEFAULT_ACHIEVEMENTS_CONFIG.definitions[0]];
    expect(() => validateAchievementsConfig({ enabled: true, definitions: dup })).toThrow(AchievementError);
    expect(() =>
      validateAchievementsConfig(
        cfg((x) => {
          x.definitions[1]!.ruleConfig["holders"] = -5;
        }),
      ),
    ).toThrow(AchievementError);
  });

  it("keeps code-defined achievements missing from the stored config", () => {
    const partial = { enabled: true, definitions: [DEFAULT_ACHIEVEMENTS_CONFIG.definitions[0]] };
    expect(validateAchievementsConfig(partial).definitions).toHaveLength(10);
  });

  it("rejects an invalid category or rarity", () => {
    expect(() =>
      validateAchievementsConfig(
        cfg((x) => {
          (x.definitions[0] as { category: string }).category = "money";
        }),
      ),
    ).toThrow(AchievementError);
  });
});
