import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REWARD_RULES, type RewardProgram, type RewardRules } from "./rewards-types";

const mocks = vi.hoisted(() => ({
  profiles: [] as Record<string, unknown>[],
  programs: [] as RewardProgram[],
  points: new Map<string, number>(),
  pointsAvailable: true,
  achievementsAvailable: true,
  listProgramsError: null as Error | null,
  getCreatorIndex: vi.fn(),
}));

vi.mock("./rewards-store.server", () => ({
  listPrograms: vi.fn(async () => {
    if (mocks.listProgramsError) throw mocks.listProgramsError;
    return mocks.programs;
  }),
  appendEligibilitySnapshots: vi.fn(async () => ({ inserted: 0, duplicates: 0, error: null })),
  rewardsReady: vi.fn(async () => ({ ready: true, error: null })),
}));

vi.mock("./rewards-config.server", () => ({
  acquireRewardsLock: vi.fn(async () => ({ acquired: true, token: "test" })),
  loadRewardsState: vi.fn(),
  releaseRewardsLock: vi.fn(async () => undefined),
  saveRewardsState: vi.fn(async () => undefined),
}));

vi.mock("@/lib/creator/creator-service.server", () => ({
  getCreatorIndex: mocks.getCreatorIndex,
}));

vi.mock("@/lib/points/points-store.server", () => ({
  ledgerReady: vi.fn(async () => ({ ready: mocks.pointsAvailable, error: mocks.pointsAvailable ? null : "unavailable" })),
  totalsByCreator: vi.fn(async () => mocks.points),
  seasonTotalsByCreator: vi.fn(async () => mocks.points),
}));

vi.mock("@/lib/levels/levels-config.server", () => ({
  loadLevelsConfig: vi.fn(async () => ({ enabled: false })),
}));

vi.mock("@/lib/achievements/achievement-engine.server", () => ({
  achievementBadgesFor: vi.fn(async () => {
    if (!mocks.achievementsAvailable) throw new Error("achievements unavailable");
    return new Map();
  }),
}));

import { buildEvaluationContexts, resetRewardsCache, runRewardsEngine } from "./rewards-engine.server";

const ADDRESS_A = `0x${"a".repeat(40)}`;
const ADDRESS_B = `0x${"b".repeat(40)}`;

function profile(address: string) {
  return {
    address,
    chainId: 56,
    score: 10,
    parts: { organicActivity: 10 },
    tokens: [],
    stats: {
      graduatedTokens: 0,
      volume24h: 0,
      organicVolume24h: 0,
      trades24h: 0,
      uniqueBuyers: 0,
      uniqueSellers: 0,
    },
    customization: { displayName: null, avatarUrl: null },
  };
}

function program(patch: Partial<RewardProgram> = {}): RewardProgram {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    chainId: 56,
    name: "Programa de prueba",
    slug: "programa-prueba",
    description: null,
    status: "active",
    startsAt: null,
    endsAt: null,
    seasonId: null,
    evaluationWindow: "current",
    evaluationStart: null,
    evaluationEnd: null,
    ruleVersion: 1,
    rules: DEFAULT_REWARD_RULES,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...patch,
  };
}

async function discover(p = program()) {
  return buildEvaluationContexts(p, { start: null, end: null, key: "current" }, null);
}

describe("Rewards creator discovery", () => {
  beforeEach(() => {
    resetRewardsCache();
    mocks.profiles = [];
    mocks.programs = [];
    mocks.points = new Map();
    mocks.pointsAvailable = true;
    mocks.achievementsAvailable = true;
    mocks.listProgramsError = null;
    mocks.getCreatorIndex.mockReset();
    mocks.getCreatorIndex.mockImplementation(async () => ({ profiles: mocks.profiles, source: "test" }));
  });

  it.each([
    ["0 creators", []],
    ["1 creator", [profile(ADDRESS_A)]],
    ["2 creators", [profile(ADDRESS_A), profile(ADDRESS_B)]],
  ])("descubre %s desde el mismo Creator Index del Leaderboard", async (_label, profiles) => {
    mocks.profiles = profiles;
    const result = await discover();
    expect(result.contexts).toHaveLength(profiles.length);
    expect(result.contexts.map((c) => c.address)).toEqual(profiles.map((p) => p.address));
  });

  it("no elimina creators que todavía no cumplen los requisitos", async () => {
    mocks.profiles = [profile(ADDRESS_A), profile(ADDRESS_B)];
    mocks.points = new Map([
      [ADDRESS_A, 0],
      [ADDRESS_B, 0],
    ]);
    const result = await discover();
    expect(result.contexts).toHaveLength(2);
    expect(result.contexts.every((c) => c.metrics.points === 0)).toBe(true);
  });

  it("mantiene al creator y marca N/A cuando falta una métrica", async () => {
    mocks.profiles = [profile(ADDRESS_A)];
    mocks.achievementsAvailable = false;
    const requiredAchievements: RewardRules = {
      ...DEFAULT_REWARD_RULES,
      criteria: {
        ...DEFAULT_REWARD_RULES.criteria,
        achievements: { ...DEFAULT_REWARD_RULES.criteria.achievements, required: true },
      },
    };
    const result = await discover(program({ rules: requiredAchievements }));
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]?.metrics.achievements).toBeNull();
    expect(result.warnings).toContain("Achievements no disponible");
  });

  it("diagnostica explícitamente cuando no hay programa activo", async () => {
    const result = await runRewardsEngine("test", { dryRun: true });
    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toContain("No hay programas activos");
    expect(result.state.creatorsEvaluated).toBe(0);
    expect(mocks.getCreatorIndex).not.toHaveBeenCalled();
  });

  it("diagnostica un programId inválido", async () => {
    mocks.programs = [program()];
    const result = await runRewardsEngine("test", {
      dryRun: true,
      programId: "00000000-0000-4000-8000-000000000099",
    });
    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toContain("programa solicitado no existe");
  });

  it("no convierte un error de lectura de programas en cero creators", async () => {
    mocks.listProgramsError = new Error("permission denied");
    const result = await runRewardsEngine("test", { dryRun: true });
    expect(result.skipped).toBe(false);
    expect(result.state.errors).toBe(1);
    expect(result.state.lastError).toContain("permission denied");
  });

  it("marca NO_ACTIVE_PROGRAM cuando no hay programas activos", async () => {
    const result = await runRewardsEngine("test", { dryRun: true });
    expect(result.skippedReason).toContain("NO_ACTIVE_PROGRAM");
  });

  it("marca PROGRAM_NOT_FOUND con un programId inexistente", async () => {
    mocks.programs = [program()];
    const result = await runRewardsEngine("test", {
      dryRun: true,
      programId: "00000000-0000-4000-8000-000000000099",
    });
    expect(result.skippedReason).toContain("PROGRAM_NOT_FOUND");
  });

  it("marca NO_CREATORS cuando el programa existe pero el índice está vacío", async () => {
    mocks.programs = [program()];
    mocks.profiles = [];
    const result = await runRewardsEngine("test", { dryRun: true });
    expect(result.skipped).toBe(false);
    expect(result.state.creatorsEvaluated).toBe(0);
    expect(result.state.notes.some((n) => n.startsWith("NO_CREATORS:"))).toBe(true);
  });

  it("marca PENDING_DATA cuando falta una métrica y no la convierte en 0", async () => {
    mocks.programs = [program()];
    mocks.profiles = [profile(ADDRESS_A)];
    mocks.achievementsAvailable = false;
    const result = await runRewardsEngine("test", { dryRun: true });
    expect(result.state.creatorsEvaluated).toBe(1);
    expect(result.state.notes.some((n) => n.startsWith("PENDING_DATA:"))).toBe(true);
  });
});