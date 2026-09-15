// 🎁 Fase 2G — Reward Allocation Engine (server only).
//
// Reads the LAST eligibility batch of each program (Fase 2F) and turns it into
// relative weights. It CREATES nothing and MODIFIES nothing upstream:
//   • no contract call    • no transaction    • no transfer    • no claim
//   • no changes to Points, Levels, Achievements, Leaderboard or Eligibility
//
// `dryRun` NEVER writes. Real runs write append-only snapshots whose UNIQUE
// fingerprint makes repeated executions insert 0 duplicates.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import { effectiveProgramStatus, sha256 } from "./rewards-rules";
import {
  allocationBasisHash,
  allocationFingerprintInput,
  computeAllocation,
  publicAllocationEntries,
} from "./allocation-rules";
import {
  EMPTY_ALLOCATION_STATE,
  type AllocationEngineState,
  type AllocationProgramRun,
  type AllocationRunResult,
  type AllocationSnapshotRow,
  type PublicAllocation,
} from "./allocation-types";
import * as alloc from "./allocation-store.server";
import * as store from "./rewards-store.server";
import { acquireRewardsLock, releaseRewardsLock } from "./rewards-config.server";

/* ---------------------------------- engine ---------------------------------- */

export async function runAllocationEngine(
  trigger: string,
  opts: { dryRun?: boolean; programId?: string } = {},
): Promise<AllocationRunResult> {
  const dryRun = opts.dryRun ?? false;
  const scope = opts.programId ? `allocation:${opts.programId}` : "allocation";
  const lock = await acquireRewardsLock(scope);
  if (!lock.acquired) {
    const state = await alloc.loadAllocationState();
    return {
      state,
      programs: [],
      dryRun,
      skipped: true,
      skippedReason: `Otra ejecución de Allocation está en curso desde ${lock.heldSince ?? "?"}.`,
    };
  }

  const started = Date.now();
  const state: AllocationEngineState = {
    ...EMPTY_ALLOCATION_STATE,
    runId: crypto.randomUUID(),
    trigger,
    startedAt: new Date(started).toISOString(),
    notes: [],
  };
  const runs: AllocationProgramRun[] = [];

  try {
    const all = await store.listPrograms(ACTIVE_CHAIN_ID);
    const targets = opts.programId
      ? all.filter((p) => p.id === opts.programId)
      : all.filter((p) => effectiveProgramStatus(p) === "active");

    if (!targets.length) {
      const reason = opts.programId
        ? "PROGRAM_NOT_FOUND: El programa solicitado no existe en la red activa."
        : "NO_ACTIVE_PROGRAM: No hay programas activos. Activa un Reward Program antes de calcular allocation.";
      state.notes.push(reason);
      state.finishedAt = new Date().toISOString();
      state.durationMs = Date.now() - started;
      return { state, programs: [], dryRun, skipped: true, skippedReason: reason };
    }

    const evaluatedAt = new Date().toISOString();

    for (const program of targets) {
      try {
        const record = await alloc.loadAllocationConfig(program.id);
        if (!record.config.enabled) {
          state.notes.push(`ALLOCATION_DISABLED: ${program.name}: la allocation está desactivada en este programa.`);
          continue;
        }

        const batch = await alloc.latestEligibilityBatch(ACTIVE_CHAIN_ID, program.id);
        if (!batch.inputs.length) {
          state.notes.push(
            `NO_ELIGIBILITY_SNAPSHOT: ${program.name}: todavía no hay evaluaciones de elegibilidad. Ejecuta primero el Eligibility Engine.`,
          );
          continue;
        }

        const computation = computeAllocation(batch.inputs, record.config);
        const basisHash = await allocationBasisHash(batch.inputs);
        const ruleVersion = batch.ruleVersion ?? program.ruleVersion;

        state.programsEvaluated += 1;
        state.creatorsEvaluated += computation.totals.evaluated;
        state.eligible += computation.totals.eligible;
        state.recipients += computation.totals.recipients;
        state.pendingData += computation.totals.pendingData;
        state.totalPct = computation.totals.totalPct;
        if (computation.totals.totalAmount != null) {
          state.totalAmount = (state.totalAmount ?? 0) + computation.totals.totalAmount;
        }
        for (const w of computation.warnings) state.notes.push(`${program.name}: ${w}`);

        const run: AllocationProgramRun = {
          programId: program.id,
          programName: program.name,
          slug: program.slug,
          ruleVersion,
          allocationVersion: record.version,
          basisHash,
          eligibilityEvaluatedAt: batch.evaluatedAt ?? evaluatedAt,
          computation,
          snapshotsCreated: 0,
          duplicates: 0,
          error: null,
        };

        if (!dryRun) {
          const rows: AllocationSnapshotRow[] = await Promise.all(
            computation.results.map(async (r) => ({
              chainId: ACTIVE_CHAIN_ID,
              programId: program.id,
              ruleVersion,
              allocationVersion: record.version,
              basisHash,
              eligibilityEvaluatedAt: batch.evaluatedAt ?? evaluatedAt,
              creatorAddress: r.address,
              eligibilityStatus: r.eligibilityStatus,
              status: r.status,
              allocationScore: r.allocationScore,
              normalizedWeight: r.normalizedWeight,
              allocationPct: r.allocationPct,
              allocationAmount: r.allocationAmount,
              poolTotal: computation.totals.poolTotal,
              poolUnit: computation.totals.poolUnit,
              method: computation.method,
              factorsResult: { factors: r.factors, reasons: r.reasons, capped: r.capped, floored: r.floored },
              reasons: r.reasons,
              evaluatedAt,
              fingerprint: await sha256(
                allocationFingerprintInput({
                  chainId: ACTIVE_CHAIN_ID,
                  programId: program.id,
                  ruleVersion,
                  allocationVersion: record.version,
                  basisHash,
                  creatorAddress: r.address,
                }),
              ),
            })),
          );
          const res = await alloc.appendAllocationSnapshots(rows);
          run.snapshotsCreated = res.inserted;
          run.duplicates = res.duplicates;
          state.snapshotsCreated += res.inserted;
          state.duplicates += res.duplicates;
          if (res.error) {
            run.error = res.error;
            state.errors += 1;
            state.lastError = res.error;
            state.notes.push(`ALLOCATION_ERROR: ${program.name}: ${res.error}`);
          }
        }

        runs.push(run);
      } catch (e) {
        state.errors += 1;
        state.lastError = e instanceof Error ? e.message : "allocation fallida";
        state.notes.push(`ALLOCATION_ERROR: ${program.name}: ${state.lastError}`);
      }
    }

    state.finishedAt = new Date().toISOString();
    state.durationMs = Date.now() - started;
    if (!state.errors) state.lastSuccessAt = state.finishedAt;
    if (!dryRun) await alloc.saveAllocationState(state);
    return { state, programs: runs, dryRun, skipped: false, skippedReason: null };
  } catch (e) {
    state.errors += 1;
    state.lastError = e instanceof Error ? e.message : "fallo del motor de allocation";
    state.finishedAt = new Date().toISOString();
    state.durationMs = Date.now() - started;
    if (!dryRun) await alloc.saveAllocationState(state);
    return { state, programs: runs, dryRun, skipped: false, skippedReason: null };
  } finally {
    await releaseRewardsLock(scope, lock.token);
  }
}

/* ------------------------------- public read -------------------------------- */

/**
 * Public allocation of one program. Returns `visible: false` unless the admin
 * explicitly published weights, and NEVER returns amounts without a configured
 * reward pool.
 */
export async function getPublicAllocation(slug: string): Promise<PublicAllocation> {
  const empty: PublicAllocation = {
    slug,
    visible: false,
    visibility: "hidden",
    method: null,
    recipients: 0,
    totalPct: null,
    poolTotal: null,
    poolUnit: null,
    evaluatedAt: null,
    allocationVersion: null,
    entries: [],
    storageReady: false,
  };
  const ready = await alloc.allocationReady();
  if (!ready.ready) return empty;

  const program = await store.getProgramBySlug(ACTIVE_CHAIN_ID, slug);
  if (!program || program.status === "draft") return { ...empty, storageReady: true };

  const record = await alloc.loadAllocationConfig(program.id);
  const cfg = record.config;
  if (!cfg.enabled || cfg.visibility === "hidden") {
    return { ...empty, storageReady: true, visibility: cfg.visibility };
  }

  const rows = await alloc.latestAllocationBatch(ACTIVE_CHAIN_ID, program.id);
  if (!rows.length) return { ...empty, storageReady: true, visibility: cfg.visibility };

  const entries = publicAllocationEntries(rows, cfg);
  const showAmounts = cfg.visibility === "amounts" && cfg.pool.enabled && (cfg.pool.total ?? 0) > 0;
  const totalPct = entries.reduce((s, e) => s + e.allocationPct, 0);

  return {
    slug,
    visible: entries.length > 0,
    visibility: cfg.visibility,
    method: cfg.method,
    recipients: entries.length,
    totalPct: Math.round(totalPct * 10_000) / 10_000,
    poolTotal: showAmounts ? (cfg.pool.total ?? null) : null,
    poolUnit: showAmounts ? cfg.pool.unit : null,
    evaluatedAt: rows[0]?.evaluatedAt ?? null,
    allocationVersion: rows[0]?.allocationVersion ?? record.version,
    entries,
    storageReady: true,
  };
}

/** Admin view: config + last stored batch + a fresh preview of the current data. */
export async function getAllocationOverview(programId: string) {
  const [readyState, record, program] = await Promise.all([
    alloc.allocationReady(),
    alloc.loadAllocationConfig(programId),
    store.getProgramById(programId),
  ]);
  if (!program) throw new Error("Programa inexistente.");
  const [batch, stored, state] = await Promise.all([
    alloc.latestEligibilityBatch(ACTIVE_CHAIN_ID, programId).catch(() => ({ inputs: [], evaluatedAt: null, ruleVersion: null })),
    alloc.latestAllocationBatch(ACTIVE_CHAIN_ID, programId),
    alloc.loadAllocationState(),
  ]);
  const preview = batch.inputs.length ? computeAllocation(batch.inputs, record.config) : null;
  return {
    programId,
    chainId: ACTIVE_CHAIN_ID,
    storageReady: readyState.ready,
    storageError: readyState.error,
    config: record.config,
    version: record.version,
    updatedAt: record.updatedAt,
    history: record.history.slice(0, 10),
    eligibilityEvaluatedAt: batch.evaluatedAt,
    eligibilityCreators: batch.inputs.length,
    preview,
    stored: stored.slice(0, 50),
    storedEvaluatedAt: stored[0]?.evaluatedAt ?? null,
    state,
  };
}
