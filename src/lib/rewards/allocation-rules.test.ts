// 🎁 Fase 2G — Allocation rules: método, N/A, caps/floors, idempotencia.
import { describe, expect, it } from "vitest";
import {
  allocationBasisHash,
  allocationFingerprintInput,
  computeAllocation,
  publicAllocationEntries,
  validateAllocationConfig,
} from "./allocation-rules";
import { DEFAULT_ALLOCATION_CONFIG, type AllocationConfig, type AllocationInput } from "./allocation-types";
import { sha256 } from "./rewards-rules";
import type { EligibilityStatus } from "./rewards-types";

const addr = (c: string) => `0x${c.repeat(40)}`;

function input(patch: Partial<AllocationInput> & { address: string }): AllocationInput {
  return {
    eligibilityStatus: "eligible" as EligibilityStatus,
    eligibilityScore: 100,
    ruleVersion: 1,
    metrics: { points: 100, score: 50, level: 2, achievements: 1, graduations: 0, organic: 60, seasonRank: null },
    sourceFingerprint: `fp-${patch.address}`,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

const config = (patch: Partial<AllocationConfig> = {}): AllocationConfig => ({
  ...DEFAULT_ALLOCATION_CONFIG,
  enabled: true,
  ...patch,
});

describe("validateAllocationConfig", () => {
  it("rejects publishing amounts without a reward pool", () => {
    expect(() => validateAllocationConfig({ ...config(), visibility: "amounts" })).toThrow();
  });

  it("rejects a weighted method with no active factor", () => {
    const factors = { ...DEFAULT_ALLOCATION_CONFIG.factors };
    for (const k of Object.keys(factors) as (keyof typeof factors)[]) factors[k] = { enabled: false, weight: 0 };
    expect(() => validateAllocationConfig({ ...config(), factors })).toThrow();
  });

  it("rejects a floor above the cap and an active pool without total", () => {
    expect(() => validateAllocationConfig({ ...config(), maxSharePct: 10, minSharePct: 20 })).toThrow();
    expect(() => validateAllocationConfig({ ...config(), pool: { enabled: true, total: null, unit: null } })).toThrow();
  });

  it("accepts a valid configuration with pool and amounts", () => {
    const parsed = validateAllocationConfig({
      ...config(),
      visibility: "amounts",
      pool: { enabled: true, total: 1000, unit: "puntos" },
    });
    expect(parsed.pool.total).toBe(1000);
    expect(parsed.visibility).toBe("amounts");
  });
});

describe("computeAllocation", () => {
  it("only eligible creators receive allocation", () => {
    const res = computeAllocation(
      [
        input({ address: addr("a") }),
        input({ address: addr("b"), eligibilityStatus: "not_eligible" }),
        input({ address: addr("c"), eligibilityStatus: "pending" }),
        input({ address: addr("d"), eligibilityStatus: "excluded" }),
      ],
      config(),
    );
    const byAddr = new Map(res.results.map((r) => [r.address, r]));
    expect(byAddr.get(addr("a"))!.status).toBe("allocated");
    expect(byAddr.get(addr("a"))!.allocationPct).toBeCloseTo(100, 6);
    for (const c of ["b", "c", "d"]) {
      const r = byAddr.get(addr(c))!;
      expect(r.allocationPct).toBeNull();
      expect(r.normalizedWeight).toBeNull();
      expect(r.allocationAmount).toBeNull();
    }
    expect(res.totals.recipients).toBe(1);
  });

  it("weighted split reflects the real metrics and sums 100%", () => {
    const res = computeAllocation(
      [
        input({ address: addr("a"), metrics: { points: 100, score: 50, level: 2, achievements: 2, graduations: 1, organic: 60, seasonRank: null } }),
        input({ address: addr("b"), metrics: { points: 50, score: 25, level: 1, achievements: 1, graduations: 0, organic: 30, seasonRank: null } }),
      ],
      config(),
    );
    const a = res.results.find((r) => r.address === addr("a"))!;
    const b = res.results.find((r) => r.address === addr("b"))!;
    expect(a.allocationPct!).toBeGreaterThan(b.allocationPct!);
    expect(a.allocationPct! + b.allocationPct!).toBeCloseTo(100, 4);
    expect(res.totals.totalPct).toBeCloseTo(100, 4);
  });

  it("N/A is never 0: a creator with no data at all is pending_data, not allocated", () => {
    const empty = { points: null, score: null, level: null, achievements: null, graduations: null, organic: null, seasonRank: null };
    const res = computeAllocation(
      [input({ address: addr("a") }), input({ address: addr("b"), eligibilityScore: Number.NaN, metrics: empty })],
      config({
        factors: { ...DEFAULT_ALLOCATION_CONFIG.factors, eligibilityScore: { enabled: true, weight: 30 } },
      }),
    );
    const b = res.results.find((r) => r.address === addr("b"))!;
    expect(b.status).toBe("pending_data");
    expect(b.allocationScore).toBeNull();
    expect(b.allocationPct).toBeNull();
    expect(res.totals.pendingData).toBe(1);
    expect(res.totals.totalPct).toBeCloseTo(100, 4);
  });

  it("missing factors redistribute their weight instead of scoring 0", () => {
    const res = computeAllocation(
      [
        input({ address: addr("a"), metrics: { points: 100, score: 50, level: 2, achievements: 1, graduations: 1, organic: 60, seasonRank: null } }),
        input({ address: addr("b"), metrics: { points: 100, score: 50, level: 2, achievements: null, graduations: 1, organic: 60, seasonRank: null } }),
      ],
      config(),
    );
    const b = res.results.find((r) => r.address === addr("b"))!;
    expect(b.factors.find((f) => f.key === "achievements")!.normalized).toBeNull();
    expect(b.allocationScore).toBeCloseTo(100, 4);
  });

  it("applies caps and leaves the remainder unallocated", () => {
    const res = computeAllocation(
      [
        input({ address: addr("a"), metrics: { points: 1000, score: 90, level: 5, achievements: 5, graduations: 3, organic: 90, seasonRank: null } }),
        input({ address: addr("b"), metrics: { points: 1, score: 1, level: 1, achievements: 0, graduations: 0, organic: 1, seasonRank: null } }),
      ],
      config({ maxSharePct: 40 }),
    );
    for (const r of res.results) expect(r.allocationPct!).toBeLessThanOrEqual(40 + 1e-6);
    expect(res.totals.totalPct).toBeLessThanOrEqual(100);
    expect(res.totals.unallocatedPct).toBeGreaterThan(0);
  });

  it("applies floors without exceeding 100%", () => {
    const res = computeAllocation(
      [
        input({ address: addr("a"), metrics: { points: 1000, score: 90, level: 5, achievements: 5, graduations: 3, organic: 90, seasonRank: null } }),
        input({ address: addr("b"), metrics: { points: 1, score: 1, level: 1, achievements: 0, graduations: 0, organic: 1, seasonRank: null } }),
      ],
      config({ minSharePct: 30 }),
    );
    const b = res.results.find((r) => r.address === addr("b"))!;
    expect(b.allocationPct!).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(res.totals.totalPct).toBeLessThanOrEqual(100 + 1e-6);
  });

  it("minEligibilityScore and maxRecipients exclude creators from the split", () => {
    const low = computeAllocation(
      [input({ address: addr("a") }), input({ address: addr("b"), eligibilityScore: 10 })],
      config({ minEligibilityScore: 50 }),
    );
    expect(low.results.find((r) => r.address === addr("b"))!.status).toBe("below_threshold");

    const top = computeAllocation(
      [
        input({ address: addr("a"), metrics: { points: 500, score: 80, level: 4, achievements: 3, graduations: 2, organic: 80, seasonRank: null } }),
        input({ address: addr("b"), metrics: { points: 10, score: 5, level: 1, achievements: 0, graduations: 0, organic: 5, seasonRank: null } }),
      ],
      config({ maxRecipients: 1 }),
    );
    expect(top.results.find((r) => r.address === addr("b"))!.status).toBe("not_selected");
    expect(top.totals.totalPct).toBeCloseTo(100, 4);
  });

  it("equal method splits evenly", () => {
    const res = computeAllocation([input({ address: addr("a") }), input({ address: addr("b") })], config({ method: "equal" }));
    for (const r of res.results) expect(r.allocationPct!).toBeCloseTo(50, 4);
  });

  it("amounts exist only when a reward pool is configured", () => {
    const withoutPool = computeAllocation([input({ address: addr("a") })], config());
    expect(withoutPool.results[0]!.allocationAmount).toBeNull();
    expect(withoutPool.totals.totalAmount).toBeNull();

    const withPool = computeAllocation(
      [input({ address: addr("a") }), input({ address: addr("b") })],
      config({ pool: { enabled: true, total: 1000, unit: "puntos" } }),
    );
    expect(withPool.totals.totalAmount).toBeCloseTo(1000, 4);
    expect(withPool.results[0]!.allocationAmount).toBeCloseTo(500, 4);
  });

  it("is deterministic: same inputs in any order give the same result", () => {
    const a = input({ address: addr("a") });
    const b = input({ address: addr("b"), metrics: { points: 20, score: 10, level: 1, achievements: 0, graduations: 0, organic: 10, seasonRank: null } });
    const one = computeAllocation([a, b], config());
    const two = computeAllocation([b, a], config());
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});

describe("idempotencia", () => {
  it("the basis hash only depends on the eligibility set, not on its order", async () => {
    const a = input({ address: addr("a") });
    const b = input({ address: addr("b") });
    expect(await allocationBasisHash([a, b])).toBe(await allocationBasisHash([b, a]));
    expect(await allocationBasisHash([a])).not.toBe(await allocationBasisHash([a, b]));
  });

  it("the same evaluation produces the same fingerprint (0 duplicates)", async () => {
    const parts = {
      chainId: 56,
      programId: "prog",
      ruleVersion: 1,
      allocationVersion: 2,
      basisHash: "basis",
      creatorAddress: addr("A").toUpperCase(),
    };
    const first = await sha256(allocationFingerprintInput(parts));
    const second = await sha256(allocationFingerprintInput({ ...parts, creatorAddress: addr("a") }));
    expect(first).toBe(second);
    const other = await sha256(allocationFingerprintInput({ ...parts, allocationVersion: 3 }));
    expect(other).not.toBe(first);
  });
});

describe("publicAllocationEntries", () => {
  const rows = [
    { creatorAddress: addr("a"), status: "allocated" as const, allocationPct: 60, normalizedWeight: 0.6, allocationAmount: 600 },
    { creatorAddress: addr("b"), status: "allocated" as const, allocationPct: 40, normalizedWeight: 0.4, allocationAmount: 400 },
    { creatorAddress: addr("c"), status: "not_eligible" as const, allocationPct: null, normalizedWeight: null, allocationAmount: null },
  ];

  it("hides everything when visibility is hidden or allocation is off", () => {
    expect(publicAllocationEntries(rows, config({ visibility: "hidden" }))).toHaveLength(0);
    expect(publicAllocationEntries(rows, config({ enabled: false, visibility: "weights" }))).toHaveLength(0);
  });

  it("shows weights without amounts, and amounts only with a pool", () => {
    const weights = publicAllocationEntries(rows, config({ visibility: "weights" }));
    expect(weights).toHaveLength(2);
    expect(weights[0]!.allocationAmount).toBeNull();

    const amounts = publicAllocationEntries(
      rows,
      config({ visibility: "amounts", pool: { enabled: true, total: 1000, unit: "puntos" } }),
    );
    expect(amounts[0]!.allocationAmount).toBe(600);
  });
});
