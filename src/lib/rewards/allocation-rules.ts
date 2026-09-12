// 🎁 Fase 2G — pure allocation rules. No I/O, no RPC, no database: testable.
//
// Reuses the Rewards/Leaderboard primitives (sha256, round2) so there is one
// implementation of each. Nothing here transfers value: it only turns a list
// of eligibility results into relative weights.
import {
  ALLOCATION_FACTOR_KEYS,
  ALLOCATION_FACTOR_LABEL,
  ALLOCATION_METHODS,
  ALLOCATION_VISIBILITIES,
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationComputation,
  type AllocationConfig,
  type AllocationFactor,
  type AllocationFactorKey,
  type AllocationFactorResult,
  type AllocationInput,
  type AllocationResult,
  type AllocationStatus,
} from "./allocation-types";
import { RewardsError, round2, sha256 } from "./rewards-rules";

/* ------------------------------- validation -------------------------------- */

function num(value: unknown, fallback: number | null, label: string): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new RewardsError(`Valor numérico inválido en "${label}".`);
  return n;
}

function validateFactor(key: AllocationFactorKey, input: unknown, fallback: AllocationFactor): AllocationFactor {
  const raw = (input ?? {}) as Partial<AllocationFactor>;
  const weight = num(raw.weight, fallback.weight, ALLOCATION_FACTOR_LABEL[key]) ?? 0;
  if (weight < 0 || weight > 100) {
    throw new RewardsError(`El peso de "${ALLOCATION_FACTOR_LABEL[key]}" debe estar entre 0 y 100.`);
  }
  return { enabled: raw.enabled === undefined ? fallback.enabled : !!raw.enabled, weight };
}

export function validateAllocationConfig(input: unknown): AllocationConfig {
  const raw = (input ?? {}) as Partial<AllocationConfig> & { factors?: Record<string, unknown>; pool?: Record<string, unknown> };
  const fb = DEFAULT_ALLOCATION_CONFIG;

  const method = raw.method === undefined ? fb.method : raw.method;
  if (!ALLOCATION_METHODS.includes(method)) throw new RewardsError("Método de allocation desconocido.");

  const visibility = raw.visibility === undefined ? fb.visibility : raw.visibility;
  if (!ALLOCATION_VISIBILITIES.includes(visibility)) throw new RewardsError("Visibilidad pública desconocida.");

  const factors = {} as Record<AllocationFactorKey, AllocationFactor>;
  for (const key of ALLOCATION_FACTOR_KEYS) factors[key] = validateFactor(key, raw.factors?.[key], fb.factors[key]);
  if (method === "weighted" && !ALLOCATION_FACTOR_KEYS.some((k) => factors[k].enabled && factors[k].weight > 0)) {
    throw new RewardsError("El método ponderado necesita al menos un factor activo con peso mayor que 0.");
  }

  const minEligibilityScore = num(raw.minEligibilityScore, fb.minEligibilityScore, "Eligibility Score mínimo");
  if (minEligibilityScore != null && (minEligibilityScore < 0 || minEligibilityScore > 100)) {
    throw new RewardsError("El Eligibility Score mínimo debe estar entre 0 y 100.");
  }

  const maxSharePct = num(raw.maxSharePct, fb.maxSharePct, "Cap por creador");
  if (maxSharePct != null && (maxSharePct <= 0 || maxSharePct > 100)) {
    throw new RewardsError("El cap por creador debe estar entre 0 (exclusivo) y 100 %.");
  }
  const minSharePct = num(raw.minSharePct, fb.minSharePct, "Floor por creador");
  if (minSharePct != null && (minSharePct < 0 || minSharePct > 100)) {
    throw new RewardsError("El floor por creador debe estar entre 0 y 100 %.");
  }
  if (maxSharePct != null && minSharePct != null && minSharePct > maxSharePct) {
    throw new RewardsError("El floor por creador no puede superar el cap.");
  }

  const maxRecipients = num(raw.maxRecipients, fb.maxRecipients, "Máximo de destinatarios");
  if (maxRecipients != null && (!Number.isInteger(maxRecipients) || maxRecipients < 1)) {
    throw new RewardsError("El máximo de destinatarios debe ser un entero ≥ 1.");
  }

  const poolRaw = raw.pool ?? {};
  const poolTotal = num(poolRaw["total"], fb.pool.total, "Reward pool");
  if (poolTotal != null && poolTotal < 0) throw new RewardsError("El reward pool no puede ser negativo.");
  const poolEnabled = poolRaw["enabled"] === undefined ? fb.pool.enabled : !!poolRaw["enabled"];
  const unitRaw = poolRaw["unit"];
  const poolUnit = typeof unitRaw === "string" && unitRaw.trim() ? unitRaw.trim().slice(0, 16) : null;
  if (poolEnabled && (poolTotal == null || poolTotal <= 0)) {
    throw new RewardsError("Un reward pool activo necesita un total mayor que 0.");
  }
  if (visibility === "amounts" && !poolEnabled) {
    throw new RewardsError("Solo se pueden publicar importes si el programa tiene un reward pool configurado.");
  }

  return {
    enabled: raw.enabled === undefined ? fb.enabled : !!raw.enabled,
    method,
    factors,
    minEligibilityScore,
    maxSharePct,
    minSharePct,
    maxRecipients,
    pool: { enabled: poolEnabled, total: poolEnabled ? poolTotal : poolTotal ?? null, unit: poolUnit },
    visibility,
  };
}

/* -------------------------------- fingerprint ------------------------------- */

/**
 * The basis hash identifies EXACTLY the set of eligibility snapshots used as
 * input. Same input set + same versions ⇒ same fingerprint ⇒ 0 duplicates.
 */
export async function allocationBasisHash(inputs: AllocationInput[]): Promise<string> {
  const parts = inputs.map((i) => i.sourceFingerprint).sort();
  return sha256(`ALLOCATION_BASIS|${parts.join(",")}`);
}

/** ALLOCATION|chain|program|r{ruleVersion}|a{allocationVersion}|basis|creator */
export function allocationFingerprintInput(parts: {
  chainId: number;
  programId: string;
  ruleVersion: number;
  allocationVersion: number;
  basisHash: string;
  creatorAddress: string;
}): string {
  return [
    "ALLOCATION",
    parts.chainId,
    parts.programId,
    `r${parts.ruleVersion}`,
    `a${parts.allocationVersion}`,
    parts.basisHash,
    parts.creatorAddress.toLowerCase(),
  ].join("|");
}

/* -------------------------------- computation ------------------------------- */

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function factorValue(input: AllocationInput, key: AllocationFactorKey): number | null {
  switch (key) {
    case "eligibilityScore":
      return Number.isFinite(input.eligibilityScore) ? input.eligibilityScore : null;
    case "points":
      return input.metrics.points;
    case "score":
      return input.metrics.score;
    case "level":
      return input.metrics.level;
    case "achievements":
      return input.metrics.achievements;
    case "graduations":
      return input.metrics.graduations;
    case "organic":
      return input.metrics.organic;
    case "seasonRank":
      return input.metrics.seasonRank;
  }
}

function enabledFactors(config: AllocationConfig): AllocationFactorKey[] {
  if (config.method !== "weighted") return [];
  return ALLOCATION_FACTOR_KEYS.filter((k) => config.factors[k].enabled && config.factors[k].weight > 0);
}

const compareByAddress = (a: { address: string }, b: { address: string }) => a.address.localeCompare(b.address);

/**
 * Applies floors/caps by water-filling: violators are fixed at the bound and
 * the remainder is re-split proportionally among the free ones. Converges in
 * ≤ n rounds. Returns the final pcts plus which entries were capped/floored.
 */
function applyBounds(
  raw: number[],
  floor: number | null,
  cap: number | null,
  warnings: string[],
): { pct: number[]; capped: boolean[]; floored: boolean[] } {
  const n = raw.length;
  const pct = new Array<number>(n).fill(0);
  const capped = new Array<boolean>(n).fill(false);
  const floored = new Array<boolean>(n).fill(false);
  if (!n) return { pct, capped, floored };

  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const share = (i: number, base: number, budget: number, freeCount: number) =>
    base > 0 ? (raw[i]! / base) * budget : budget / freeCount;

  if (rawTotal <= 0) warnings.push("ZERO_SCORES_EQUAL_SPLIT: todos los allocation scores son 0; reparto igualitario entre elegibles.");

  if (floor != null && floor * n > 100 + 1e-9) {
    warnings.push(`BOUNDS_INFEASIBLE: ${n} destinatarios × floor ${floor}% supera el 100 %; el floor se ignora en esta ejecución.`);
    floor = null;
  }

  const fixed = new Set<number>();
  for (let round = 0; round <= n; round++) {
    const free = [...Array(n).keys()].filter((i) => !fixed.has(i));
    const budget = 100 - [...fixed].reduce((s, i) => s + pct[i]!, 0);
    if (!free.length) break;
    const base = free.reduce((s, i) => s + raw[i]!, 0);
    for (const i of free) pct[i] = Math.max(0, share(i, base, budget, free.length));

    let changed = false;
    for (const i of free) {
      if (cap != null && pct[i]! > cap + 1e-9) {
        pct[i] = cap;
        capped[i] = true;
        fixed.add(i);
        changed = true;
      } else if (floor != null && pct[i]! < floor - 1e-9) {
        pct[i] = floor;
        floored[i] = true;
        fixed.add(i);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const total = pct.reduce((a, b) => a + b, 0);
  if (total > 100 + 1e-6) {
    // Only reachable when floors were fixed and no free budget remained.
    const k = 100 / total;
    for (let i = 0; i < n; i++) pct[i] = pct[i]! * k;
    warnings.push("BOUNDS_RESCALED: los límites configurados no permitían un reparto del 100 %; se ha reescalado.");
  } else if (total < 100 - 1e-6) {
    warnings.push(
      `UNALLOCATED_REMAINDER: el cap deja ${round4(100 - total)} % sin asignar (${n} destinatarios × cap ${cap ?? "—"} %).`,
    );
  }
  return { pct, capped, floored };
}

/**
 * Eligibility → Allocation. Pure and deterministic: same inputs + same config
 * ⇒ same output, in the same order.
 *
 *  1. Only `eligible` creators can receive allocation.
 *  2. `minEligibilityScore` / `maxRecipients` narrow the recipients.
 *  3. weighted: score = Σ weight × normalized(metric) over AVAILABLE factors
 *     (N/A factors redistribute their weight; a creator with no data at all
 *     gets `null`, never 0).  equal: every recipient scores 100.
 *  4. pct = score / Σ score × 100, then floors/caps by water-filling.
 *  5. amount = pool.total × pct / 100 ONLY when the pool is configured.
 */
export function computeAllocation(inputsRaw: AllocationInput[], config: AllocationConfig): AllocationComputation {
  const warnings: string[] = [];
  const inputs = [...inputsRaw].sort(compareByAddress);
  const keys = enabledFactors(config);
  const poolActive = config.pool.enabled && config.pool.total != null && config.pool.total > 0;
  const poolTotal = poolActive ? config.pool.total! : null;

  type Draft = {
    input: AllocationInput;
    status: AllocationStatus;
    score: number | null;
    factors: AllocationFactorResult[];
    reasons: string[];
  };

  const drafts: Draft[] = inputs.map((input) => {
    const reasons: string[] = [];
    let status: AllocationStatus;
    if (input.eligibilityStatus !== "eligible") {
      status = input.eligibilityStatus;
      reasons.push(`Elegibilidad: ${input.eligibilityStatus}.`);
    } else if (config.minEligibilityScore != null && input.eligibilityScore < config.minEligibilityScore) {
      status = "below_threshold";
      reasons.push(`Eligibility Score ${round2(input.eligibilityScore)} < mínimo ${config.minEligibilityScore}.`);
    } else {
      status = "allocated";
    }
    return { input, status, score: null, factors: [], reasons };
  });

  const candidates = drafts.filter((d) => d.status === "allocated");

  // Normalization reference per factor: the best value among candidates.
  const best = new Map<AllocationFactorKey, number>();
  for (const key of keys) {
    const values = candidates.map((d) => factorValue(d.input, key)).filter((v): v is number => v != null && Number.isFinite(v));
    if (!values.length) {
      warnings.push(`PENDING_DATA: el factor "${ALLOCATION_FACTOR_LABEL[key]}" no tiene datos para ningún elegible (N/A).`);
      continue;
    }
    best.set(key, key === "seasonRank" ? Math.min(...values) : Math.max(...values));
  }

  for (const d of candidates) {
    if (config.method === "equal") {
      d.score = 100;
      continue;
    }
    let weighted = 0;
    let available = 0;
    for (const key of keys) {
      const weight = config.factors[key].weight;
      const value = factorValue(d.input, key);
      let normalized: number | null = null;
      if (value != null && Number.isFinite(value) && best.has(key)) {
        const ref = best.get(key)!;
        if (key === "seasonRank") normalized = value > 0 ? Math.min(1, ref / value) : null;
        else normalized = ref > 0 ? Math.min(1, Math.max(0, value / ref)) : 0;
      }
      d.factors.push({ key, label: ALLOCATION_FACTOR_LABEL[key], value, normalized, weight });
      if (normalized != null) {
        weighted += weight * normalized;
        available += weight;
      }
    }
    if (available <= 0) {
      d.score = null;
      d.status = "pending_data";
      d.reasons.push("Ningún factor disponible: allocation N/A (no es 0).");
    } else {
      d.score = round2((weighted / available) * 100);
    }
  }

  // maxRecipients: keep the top N by score (ties → address order, deterministic).
  let recipients = candidates.filter((d) => d.status === "allocated");
  if (config.maxRecipients != null && recipients.length > config.maxRecipients) {
    const ordered = [...recipients].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || compareByAddress(a.input, b.input));
    const keep = new Set(ordered.slice(0, config.maxRecipients).map((d) => d.input.address));
    for (const d of recipients) {
      if (!keep.has(d.input.address)) {
        d.status = "not_selected";
        d.reasons.push(`Fuera del top ${config.maxRecipients} por allocation score.`);
      }
    }
    recipients = recipients.filter((d) => d.status === "allocated");
  }

  const bounds = applyBounds(
    recipients.map((d) => d.score ?? 0),
    config.minSharePct,
    config.maxSharePct,
    warnings,
  );

  const pctByAddress = new Map<string, { pct: number; capped: boolean; floored: boolean }>();
  recipients.forEach((d, i) => pctByAddress.set(d.input.address, { pct: bounds.pct[i]!, capped: bounds.capped[i]!, floored: bounds.floored[i]! }));

  let totalPct = 0;
  let totalAmount = 0;
  const results: AllocationResult[] = drafts.map((d) => {
    const b = pctByAddress.get(d.input.address);
    const pct = b ? b.pct : null;
    const amount = pct != null && poolTotal != null ? round6((poolTotal * pct) / 100) : null;
    if (pct != null) totalPct += pct;
    if (amount != null) totalAmount += amount;
    if (b?.capped) d.reasons.push(`Cap aplicado: ${config.maxSharePct} %.`);
    if (b?.floored) d.reasons.push(`Floor aplicado: ${config.minSharePct} %.`);
    return {
      address: d.input.address,
      eligibilityStatus: d.input.eligibilityStatus,
      eligibilityScore: d.input.eligibilityScore,
      status: d.status,
      allocationScore: d.score,
      normalizedWeight: pct == null ? null : round6(pct / 100),
      allocationPct: pct == null ? null : round4(pct),
      allocationAmount: amount,
      factors: d.factors,
      capped: !!b?.capped,
      floored: !!b?.floored,
      reasons: d.reasons,
    };
  });

  results.sort(compareResults);

  const eligible = drafts.filter((d) => d.input.eligibilityStatus === "eligible").length;
  const pendingData = drafts.filter((d) => d.status === "pending_data").length;
  if (!inputs.length) warnings.push("NO_ELIGIBILITY_SNAPSHOT: no hay evaluaciones de elegibilidad como base del cálculo.");
  else if (!eligible) warnings.push("NO_ELIGIBLE_CREATORS: ningún creador elegible en la última evaluación; nada que asignar.");

  return {
    method: config.method,
    results,
    totals: {
      evaluated: inputs.length,
      eligible,
      recipients: recipients.length,
      pendingData,
      totalPct: round4(totalPct),
      unallocatedPct: round4(Math.max(0, 100 - totalPct)),
      totalAmount: poolTotal == null ? null : round6(totalAmount),
      poolTotal,
      poolUnit: poolActive ? config.pool.unit : null,
    },
    warnings,
  };
}

const STATUS_ORDER: Record<AllocationStatus, number> = {
  allocated: 0,
  pending_data: 1,
  not_selected: 2,
  below_threshold: 3,
  pending: 4,
  not_eligible: 5,
  excluded: 6,
};

export function compareResults(a: AllocationResult, b: AllocationResult): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (b.allocationPct ?? -1) - (a.allocationPct ?? -1) ||
    (b.allocationScore ?? -1) - (a.allocationScore ?? -1) ||
    a.address.localeCompare(b.address)
  );
}

/** Public projection: strips everything the program's visibility forbids. */
export function publicAllocationEntries(
  results: { creatorAddress: string; status: AllocationStatus; allocationPct: number | null; normalizedWeight: number | null; allocationAmount: number | null }[],
  config: AllocationConfig,
) {
  if (!config.enabled || config.visibility === "hidden") return [];
  const showAmounts = config.visibility === "amounts" && config.pool.enabled && (config.pool.total ?? 0) > 0;
  return results
    .filter((r) => r.status === "allocated" && r.allocationPct != null && r.normalizedWeight != null)
    .sort((a, b) => (b.allocationPct ?? 0) - (a.allocationPct ?? 0) || a.creatorAddress.localeCompare(b.creatorAddress))
    .map((r, i) => ({
      rank: i + 1,
      address: r.creatorAddress,
      allocationPct: r.allocationPct!,
      normalizedWeight: r.normalizedWeight!,
      allocationAmount: showAmounts ? r.allocationAmount : null,
    }));
}
