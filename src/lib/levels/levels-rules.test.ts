import { describe, expect, it } from "vitest";
import {
  LevelsConfigError,
  calculateCreatorLevel,
  previewLevels,
  validateLevelsConfig,
} from "./levels-rules";
import { DEFAULT_LEVELS_CONFIG, type CreatorLevelsConfig } from "./levels-types";

const cfg = DEFAULT_LEVELS_CONFIG;
const clone = (): CreatorLevelsConfig => JSON.parse(JSON.stringify(DEFAULT_LEVELS_CONFIG));

describe("calculateCreatorLevel — thresholds", () => {
  const cases: [number, number][] = [
    [0, 1],
    [499, 1],
    [500, 2],
    [1_999, 2],
    [2_000, 3],
    [4_999, 3],
    [5_000, 4],
    [14_999, 4],
    [15_000, 5],
    [49_999, 5],
    [50_000, 6],
    [149_999, 6],
    [150_000, 7],
    [10_000_000, 7],
  ];
  for (const [points, level] of cases) {
    it(`${points} points → level ${level}`, () => {
      expect(calculateCreatorLevel(points, cfg).level).toBe(level);
    });
  }

  it("negative or invalid input is clamped to level 1 with 0 points", () => {
    expect(calculateCreatorLevel(-500, cfg).level).toBe(1);
    expect(calculateCreatorLevel(Number.NaN, cfg).totalPoints).toBe(0);
  });
});

describe("progress", () => {
  it("0% at the exact start of a level", () => {
    expect(calculateCreatorLevel(5_000, cfg).progressPercent).toBe(0);
  });

  it("50% in the middle of a level", () => {
    // Pro Creator: 5,000 → 15,000. Midpoint = 10,000.
    const r = calculateCreatorLevel(10_000, cfg);
    expect(r.progressPercent).toBe(50);
    expect(r.pointsToNextLevel).toBe(5_000);
    expect(r.nextLevelName).toBe("Elite Creator");
  });

  it("matches the spec example (8,500 points)", () => {
    const r = calculateCreatorLevel(8_500, cfg);
    expect(r.name).toBe("Pro Creator");
    expect(r.nextLevelMinPoints).toBe(15_000);
    expect(r.pointsToNextLevel).toBe(6_500);
    expect(r.progressPercent).toBe(35);
  });

  it("never exceeds 100% nor drops below 0%", () => {
    for (const p of [0, 1, 499, 4_999, 149_999, 150_000, 1_000_000]) {
      const r = calculateCreatorLevel(p, cfg);
      expect(r.progressPercent).toBeGreaterThanOrEqual(0);
      expect(r.progressPercent).toBeLessThanOrEqual(100);
    }
  });

  it("Legend is always 100% with no next level", () => {
    const r = calculateCreatorLevel(200_000, cfg);
    expect(r.level).toBe(7);
    expect(r.nextLevelMinPoints).toBeNull();
    expect(r.pointsToNextLevel).toBe(0);
    expect(r.progressPercent).toBe(100);
  });
});

describe("configuration validation", () => {
  it("accepts the default ladder", () => {
    expect(validateLevelsConfig(clone()).levels).toHaveLength(7);
  });

  it("rejects duplicate level numbers", () => {
    const c = clone();
    c.levels[2]!.level = 2;
    expect(() => validateLevelsConfig(c)).toThrow(LevelsConfigError);
  });

  it("rejects duplicate thresholds", () => {
    const c = clone();
    c.levels[2]!.minPoints = 500;
    expect(() => validateLevelsConfig(c)).toThrow(LevelsConfigError);
  });

  it("rejects descending thresholds", () => {
    const c = clone();
    c.levels[1]!.minPoints = 3_000; // level 2 above level 3
    expect(() => validateLevelsConfig(c)).toThrow(/más puntos/);
  });

  it("rejects negative thresholds", () => {
    const c = clone();
    c.levels[1]!.minPoints = -10;
    expect(() => validateLevelsConfig(c)).toThrow(LevelsConfigError);
  });

  it("rejects non-integer thresholds", () => {
    const c = clone();
    c.levels[1]!.minPoints = 500.5;
    expect(() => validateLevelsConfig(c)).toThrow(LevelsConfigError);
  });

  it("requires level 1", () => {
    const c = clone();
    c.levels = c.levels.slice(1);
    expect(() => validateLevelsConfig(c)).toThrow(/nivel 1/i);
  });

  it("requires level 1 to start at 0", () => {
    const c = clone();
    c.levels[0]!.minPoints = 100;
    expect(() => validateLevelsConfig(c)).toThrow(/0 puntos/);
  });

  it("rejects empty names and missing icons", () => {
    const a = clone();
    a.levels[3]!.name = "   ";
    expect(() => validateLevelsConfig(a)).toThrow(LevelsConfigError);
    const b = clone();
    b.levels[3]!.icon = "";
    expect(() => validateLevelsConfig(b)).toThrow(LevelsConfigError);
  });

  it("rejects an empty ladder and oversized ladders", () => {
    expect(() => validateLevelsConfig({ enabled: true, levels: [] })).toThrow(LevelsConfigError);
    const many = Array.from({ length: 25 }, (_, i) => ({
      level: i + 1,
      name: `L${i + 1}`,
      icon: "🏁",
      minPoints: i * 100,
      benefits: [],
    }));
    expect(() => validateLevelsConfig({ enabled: true, levels: many })).toThrow(/Máximo/);
  });

  it("rejects non-object payloads", () => {
    expect(() => validateLevelsConfig(null)).toThrow(LevelsConfigError);
    expect(() => validateLevelsConfig("level 7")).toThrow(LevelsConfigError);
  });

  it("round-trips a valid admin change (persistence contract)", () => {
    const c = clone();
    c.levels[1]!.minPoints = 600;
    c.levels[1]!.name = "Emerging Creator";
    const saved = validateLevelsConfig(c);
    expect(saved.levels[1]!.minPoints).toBe(600);
    expect(calculateCreatorLevel(599, saved).level).toBe(1);
    expect(calculateCreatorLevel(600, saved).level).toBe(2);
    // Ledger values are untouched: the calculator is pure input → output.
    expect(calculateCreatorLevel(600, saved).totalPoints).toBe(600);
  });

  it("keeps the disabled flag without deleting the ladder", () => {
    const saved = validateLevelsConfig({ ...clone(), enabled: false });
    expect(saved.enabled).toBe(false);
    expect(saved.levels).toHaveLength(7);
  });
});

describe("admin preview", () => {
  it("maps the documented sample points", () => {
    const rows = previewLevels(cfg);
    expect(rows.find((r) => r.points === 0)!.name).toBe("New Creator");
    expect(rows.find((r) => r.points === 499)!.name).toBe("New Creator");
    expect(rows.find((r) => r.points === 500)!.name).toBe("Rising Creator");
    expect(rows.find((r) => r.points === 150_000)!.name).toBe("Legend Creator");
  });
});

describe("security surface", () => {
  it("the calculator only accepts points — a level cannot be injected", () => {
    const forged = { level: 7, points: 0 } as unknown as number;
    expect(calculateCreatorLevel(forged, cfg).level).toBe(1);
  });

  it("levels are derived, never stored per creator (no balance object)", () => {
    const r = calculateCreatorLevel(8_500, cfg);
    expect(Object.keys(r)).not.toContain("id");
    expect(Object.keys(r)).not.toContain("balance");
  });
});
