import { describe, expect, it } from "vitest";
import {
  assertProgramTransition,
  compareEvaluations,
  countStatuses,
  effectiveProgramStatus,
  eligibilityFingerprintInput,
  eligibilityScore,
  evaluateCriterion,
  evaluateEligibility,
  evaluationBucket,
  isProgramImmutable,
  isProgramLocked,
  resolveWindow,
  riskFlagsFrom,
  validateProgramDates,
  validateRewardRules,
  withinWindow,
} from "./rewards-rules";
import { DEFAULT_REWARD_RULES, EMPTY_METRICS, type EligibilityMetrics, type RewardRules } from "./rewards-types";

const rules = (patch: Partial<RewardRules["criteria"]> = {}, exclusions: Partial<RewardRules["exclusions"]> = {}): RewardRules => ({
  criteria: { ...DEFAULT_REWARD_RULES.criteria, ...patch },
  exclusions: { ...DEFAULT_REWARD_RULES.exclusions, ...exclusions },
});

const metrics = (patch: Partial<EligibilityMetrics> = {}): EligibilityMetrics => ({
  ...EMPTY_METRICS,
  points: 1_000,
  score: 70,
  level: 3,
  achievements: 4,
  graduations: 1,
  organic: 80,
  ...patch,
});

describe("validateRewardRules", () => {
  it("acepta la configuración por defecto", () => {
    expect(validateRewardRules(DEFAULT_REWARD_RULES).criteria.points.minimum).toBe(500);
  });

  it("rechaza mínimos negativos", () => {
    expect(() => validateRewardRules({ criteria: { points: { enabled: true, minimum: -1, required: true, weight: 10 } } })).toThrow();
  });

  it("rechaza pesos fuera de rango", () => {
    expect(() => validateRewardRules({ criteria: { points: { enabled: true, minimum: 1, required: true, weight: 500 } } })).toThrow();
  });

  it("rechaza una configuración sin criterios habilitados", () => {
    const disabled = Object.fromEntries(
      Object.keys(DEFAULT_REWARD_RULES.criteria).map((k) => [k, { enabled: false, minimum: 0, required: false, weight: 0 }]),
    );
    expect(() => validateRewardRules({ criteria: disabled })).toThrow();
  });

  it("normaliza y valida las direcciones excluidas", () => {
    const out = validateRewardRules({ ...DEFAULT_REWARD_RULES, exclusions: { blockedCreators: ["0xAB".padEnd(42, "c")] } });
    expect(out.exclusions.blockedCreators[0]).toBe("0xab".padEnd(42, "c"));
    expect(() => validateRewardRules({ ...DEFAULT_REWARD_RULES, exclusions: { blockedCreators: ["nope"] } })).toThrow();
  });
});

describe("evaluateCriterion", () => {
  it("PASS cuando supera el mínimo", () => {
    expect(evaluateCriterion("points", { enabled: true, minimum: 500, required: true, weight: 10 }, 900).status).toBe("pass");
  });
  it("FAIL cuando no llega", () => {
    const r = evaluateCriterion("points", { enabled: true, minimum: 500, required: true, weight: 10 }, 250);
    expect(r.status).toBe("fail");
    expect(r.progress).toBe(0.5);
  });
  it("N/A cuando el dato no existe (nunca FAIL)", () => {
    const r = evaluateCriterion("organic", { enabled: true, minimum: 50, required: true, weight: 10 }, null);
    expect(r.status).toBe("na");
    expect(r.value).toBeNull();
  });
  it("mínimo 0 siempre pasa", () => {
    expect(evaluateCriterion("graduations", { enabled: true, minimum: 0, required: true, weight: 10 }, 0).status).toBe("pass");
  });
  it("seasonRank es inverso: menor es mejor", () => {
    const rule = { enabled: true, minimum: 10, required: true, weight: 10 };
    expect(evaluateCriterion("seasonRank", rule, 5).status).toBe("pass");
    expect(evaluateCriterion("seasonRank", rule, 25).status).toBe("fail");
  });
});

describe("evaluateEligibility", () => {
  it("eligible cuando todos los hard requirements pasan", () => {
    const e = evaluateEligibility({ address: "0x" + "1".repeat(40), metrics: metrics(), riskFlags: [] }, rules());
    expect(e.status).toBe("eligible");
    expect(e.eligibilityScore).toBeGreaterThan(0);
  });

  it("not_eligible cuando falla un hard requirement", () => {
    const e = evaluateEligibility({ address: "0x" + "2".repeat(40), metrics: metrics({ points: 100 }), riskFlags: [] }, rules());
    expect(e.status).toBe("not_eligible");
    expect(e.criteria.find((c) => c.key === "points")?.status).toBe("fail");
  });

  it("un soft requirement que falla NO bloquea", () => {
    const e = evaluateEligibility(
      { address: "0x" + "3".repeat(40), metrics: metrics({ level: 1 }), riskFlags: [] },
      rules({ level: { enabled: true, minimum: 5, required: false, weight: 15 } }),
    );
    expect(e.status).toBe("eligible");
    expect(e.eligibilityScore).toBeLessThan(100);
  });

  it("pending cuando falta un dato de un criterio obligatorio", () => {
    const e = evaluateEligibility({ address: "0x" + "4".repeat(40), metrics: metrics({ organic: null }), riskFlags: [] }, rules());
    expect(e.status).toBe("pending");
    expect(e.missingCriteria).toContain("organic");
  });

  it("excluded cuando se dispara una regla de exclusión", () => {
    const e = evaluateEligibility(
      { address: "0x" + "5".repeat(40), metrics: metrics(), riskFlags: ["self_trade_detected"] },
      rules(),
    );
    expect(e.status).toBe("excluded");
    expect(e.exclusionReasons).toContain("self_trade_detected");
  });

  it("excluded por lista de bloqueo administrada", () => {
    const address = "0x" + "6".repeat(40);
    const e = evaluateEligibility({ address, metrics: metrics(), riskFlags: [] }, rules({}, { blockedCreators: [address] }));
    expect(e.status).toBe("excluded");
  });

  it("requiere participación en temporada cuando así se configura", () => {
    const e = evaluateEligibility(
      { address: "0x" + "7".repeat(40), metrics: metrics(), riskFlags: [], participatesInSeason: false },
      rules({}, { requireSeasonParticipation: true }),
    );
    expect(e.status).toBe("excluded");
  });

  it("nunca devuelve solo true/false: siempre hay criterios explícitos", () => {
    const e = evaluateEligibility({ address: "0x" + "8".repeat(40), metrics: metrics(), riskFlags: [] }, rules());
    expect(e.criteria.length).toBeGreaterThan(3);
    for (const c of e.criteria) expect(["pass", "fail", "na"]).toContain(c.status);
  });
});

describe("eligibilityScore", () => {
  it("redistribuye el peso de los criterios no disponibles", () => {
    const all = [
      { key: "points", label: "", status: "pass", required: true, value: 1, target: 1, progress: 1, weight: 50 },
      { key: "score", label: "", status: "na", required: false, value: null, target: 10, progress: null, weight: 50 },
    ] as never[];
    expect(eligibilityScore(all)).toBe(100);
  });

  it("devuelve 0 cuando no hay criterios utilizables", () => {
    expect(eligibilityScore([])).toBe(0);
  });
});

describe("ventanas de evaluación", () => {
  const season = { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" };

  it("current no acota la ventana", () => {
    const w = resolveWindow({ evaluationWindow: "current", evaluationStart: null, evaluationEnd: null }, null);
    expect(w.start).toBeNull();
    expect(w.key).toBe("current");
  });

  it("season usa exclusivamente la ventana de la temporada", () => {
    const w = resolveWindow({ evaluationWindow: "season", evaluationStart: null, evaluationEnd: null }, season);
    expect(withinWindow("2026-08-31T23:59:00.000Z", w)).toBe(false);
    expect(withinWindow("2026-09-15T00:00:00.000Z", w)).toBe(true);
    expect(withinWindow("2026-10-01T00:00:00.000Z", w)).toBe(false); // half-open
  });

  it("historical exige inicio y fin", () => {
    expect(() => resolveWindow({ evaluationWindow: "historical", evaluationStart: null, evaluationEnd: null }, null)).toThrow();
  });

  it("valida el orden de las fechas", () => {
    expect(() => validateProgramDates("2026-10-01T00:00:00Z", "2026-09-01T00:00:00Z")).toThrow();
  });
});

describe("snapshots e idempotencia", () => {
  it("el fingerprint es determinista", () => {
    const parts = {
      chainId: 56,
      programId: "p1",
      ruleVersion: 1,
      creatorAddress: "0xAAA",
      windowKey: "current",
      evaluatedAt: "2026-09-06T12:00:00.000Z",
    };
    expect(eligibilityFingerprintInput(parts)).toBe(eligibilityFingerprintInput(parts));
    expect(eligibilityFingerprintInput(parts)).toContain("|v1|");
  });

  it("cambia con la versión de reglas (nunca recalcula el pasado)", () => {
    const base = { chainId: 56, programId: "p1", creatorAddress: "0xa", windowKey: "current", evaluatedAt: "t" };
    expect(eligibilityFingerprintInput({ ...base, ruleVersion: 1 })).not.toBe(
      eligibilityFingerprintInput({ ...base, ruleVersion: 2 }),
    );
  });

  it("el bucket colapsa ejecuciones concurrentes en un mismo snapshot", () => {
    const a = evaluationBucket(Date.parse("2026-09-06T12:01:00Z"));
    const b = evaluationBucket(Date.parse("2026-09-06T12:14:59Z"));
    expect(a).toBe(b);
  });
});

describe("ciclo de vida del programa", () => {
  it("permite transiciones válidas y bloquea las inválidas", () => {
    expect(() => assertProgramTransition("draft", "active")).not.toThrow();
    expect(() => assertProgramTransition("ended", "active")).toThrow();
    expect(() => assertProgramTransition("archived", "draft")).toThrow();
  });

  it("bloquea reglas en programas activos y congela los finalizados", () => {
    expect(isProgramLocked("active")).toBe(true);
    expect(isProgramImmutable("active")).toBe(false);
    expect(isProgramImmutable("ended")).toBe(true);
  });

  it("calcula el estado efectivo por fechas", () => {
    const now = Date.parse("2026-09-06T00:00:00Z");
    expect(effectiveProgramStatus({ status: "scheduled", startsAt: "2026-09-01T00:00:00Z", endsAt: null }, now)).toBe("active");
    expect(effectiveProgramStatus({ status: "active", startsAt: null, endsAt: "2026-09-05T00:00:00Z" }, now)).toBe("ended");
  });
});

describe("anti-farming", () => {
  it("marca self-trade cuando no hay diversidad de wallets", () => {
    const flags = riskFlagsFrom({ volume24h: 10, organicVolume24h: 10, trades24h: 40, uniqueBuyers: 1, uniqueSellers: 1, organicScore: 90 });
    expect(flags).toContain("self_trade_detected");
  });

  it("marca actividad no orgánica", () => {
    const flags = riskFlagsFrom({ volume24h: 100, organicVolume24h: 5, trades24h: 30, uniqueBuyers: 8, uniqueSellers: 4, organicScore: 10 });
    expect(flags).toContain("non_organic_activity");
  });

  it("no marca nada cuando la actividad es sana", () => {
    expect(
      riskFlagsFrom({ volume24h: 100, organicVolume24h: 95, trades24h: 30, uniqueBuyers: 20, uniqueSellers: 15, organicScore: 90 }),
    ).toEqual([]);
  });

  it("sin datos no inventa señales", () => {
    expect(riskFlagsFrom({ volume24h: null, organicVolume24h: null, trades24h: null, uniqueBuyers: null, uniqueSellers: null, organicScore: null })).toEqual([]);
  });
});

describe("orden y recuentos", () => {
  it("ordena eligible → pending → not_eligible → excluded", () => {
    const mk = (status: string, score: number) =>
      ({ status, eligibilityScore: score, metrics: EMPTY_METRICS, address: "0xa" }) as never;
    const list = [mk("excluded", 90), mk("eligible", 10), mk("pending", 50), mk("not_eligible", 80)];
    const sorted = [...list].sort(compareEvaluations).map((e: { status: string }) => e.status);
    expect(sorted).toEqual(["eligible", "pending", "not_eligible", "excluded"]);
  });

  it("cuenta cada estado", () => {
    const mk = (status: string) => ({ status }) as never;
    expect(countStatuses([mk("eligible"), mk("eligible"), mk("pending")])).toEqual({
      eligible: 2,
      not_eligible: 0,
      pending: 1,
      excluded: 0,
    });
  });
});
