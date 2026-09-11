// 🎁 Fase 2F — Creator Rewards & Airdrop Eligibility engine (server only).
//
// This engine CREATES NOTHING: no points, no achievements, no levels, no score
// and NO token distribution. It reads the existing engines, evaluates the
// configured rules and writes append-only eligibility snapshots.
//
//   • no contract calls        • no private keys        • no transfers
//   • no per-creator RPC (the Creator Index is cached and batched)
//   • unavailable metric → null → N/A → `pending`, never FAIL
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  clampPagination,
  compareEvaluations,
  countStatuses,
  effectiveProgramStatus,
  eligibilityFingerprintInput,
  evaluateEligibility,
  evaluationBucket,
  normalizeAddress,
  paginate,
  resolveWindow,
  riskFlagsFrom,
  sha256,
  withinWindow,
  type EvaluationContext,
  type ResolvedWindow,
} from "./rewards-rules";
import {
  EMPTY_REWARDS_STATE,
  type CreatorRewardsSummary,
  type EligibilityEvaluation,
  type EligibilityPage,
  type EligibilityStatus,
  type RewardProgram,
  type RewardProgramSummary,
  type RewardsEngineState,
  type RewardsRunResult,
} from "./rewards-types";
import { acquireRewardsLock, loadRewardsState, releaseRewardsLock, saveRewardsState } from "./rewards-config.server";
import * as store from "./rewards-store.server";

/* --------------------------------- caching --------------------------------- */

const CONTEXT_TTL_MS = 45_000; // §35 — 30–60s server-side cache
const contextCache = new Map<string, { at: number; contexts: EvaluationContext[]; warnings: string[] }>();

export function resetRewardsCache() {
  contextCache.clear();
}

/* -------------------------------- contexts --------------------------------- */

/**
 * Builds the evaluation context of every creator for one program window.
 * Every optional source degrades independently: a missing engine turns its
 * metric into `null` (N/A → `pending`), never into a 0 (FAIL).
 */
export async function buildEvaluationContexts(
  program: RewardProgram,
  window: ResolvedWindow,
  seasonRanks: Map<string, number> | null,
): Promise<{ contexts: EvaluationContext[]; warnings: string[] }> {
  const cacheKey = `${program.id}|${program.ruleVersion}|${window.key}`;
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    return { contexts: cached.contexts, warnings: cached.warnings };
  }

  const warnings: string[] = [];
  const creatorService = await import("@/lib/creator/creator-service.server");
  const { profiles } = await creatorService.getCreatorIndex();

  // Creator Points — reuses the EXISTING ledger, one aggregated query (no N+1).
  let points: Map<string, number> | null = null;
  try {
    const pointsStore = await import("@/lib/points/points-store.server");
    const ready = await pointsStore.ledgerReady();
    if (!ready.ready) warnings.push("Creator Points no disponible");
    else if (window.start && window.end) points = await pointsStore.seasonTotalsByCreator(ACTIVE_CHAIN_ID, window.start, window.end);
    else points = await pointsStore.totalsByCreator(ACTIVE_CHAIN_ID);
  } catch {
    warnings.push("Creator Points no disponible");
  }

  // Creator Levels — read-only, thresholds untouched.
  let levelsConfig: Awaited<ReturnType<typeof import("@/lib/levels/levels-config.server").loadLevelsConfig>> | null = null;
  try {
    const cfg = await import("@/lib/levels/levels-config.server");
    levelsConfig = await cfg.loadLevelsConfig();
  } catch {
    warnings.push("Creator Levels no disponible");
  }
  const { calculateCreatorLevel } = await import("@/lib/levels/levels-rules");

  // Achievements — ONE batched query for every creator (no N+1).
  let badges = new Map<string, { key: string }[]>();
  let achievementsAvailable = true;
  try {
    const ac = await import("@/lib/achievements/achievement-engine.server");
    badges = await ac.achievementBadgesFor(profiles.map((p) => p.address), ACTIVE_CHAIN_ID);
  } catch {
    achievementsAvailable = false;
    warnings.push("Achievements no disponible");
  }

  const contexts: EvaluationContext[] = profiles.map((p) => {
    const creatorPoints = points ? (points.get(p.address) ?? 0) : null;
    const lvl = levelsConfig?.enabled && creatorPoints != null ? calculateCreatorLevel(creatorPoints, levelsConfig) : null;

    // §17 — only real verified graduations, filtered by the evaluation window.
    const graduations =
      window.start || window.end
        ? p.tokens.filter((t) => t.graduated && t.graduatedAt && withinWindow(t.graduatedAt, window)).length
        : p.stats.graduatedTokens;

    const rank = seasonRanks ? (seasonRanks.get(p.address) ?? null) : null;

    return {
      address: p.address,
      displayName: p.customization.displayName,
      avatarUrl: p.customization.avatarUrl,
      metrics: {
        points: creatorPoints,
        score: p.score,
        level: lvl ? lvl.level : null,
        levelName: lvl ? `${lvl.icon} ${lvl.name}` : null,
        achievements: achievementsAvailable ? (badges.get(p.address.toLowerCase())?.length ?? 0) : null,
        graduations,
        // §18 — reuses the EXISTING Organic Activity component of Creator Score.
        organic: p.parts.organicActivity,
        seasonRank: rank,
      },
      riskFlags: riskFlagsFrom({
        volume24h: p.stats.volume24h,
        organicVolume24h: p.stats.organicVolume24h,
        trades24h: p.stats.trades24h,
        uniqueBuyers: p.stats.uniqueBuyers,
        uniqueSellers: p.stats.uniqueSellers,
        organicScore: p.parts.organicActivity,
      }),
      participatesInSeason: seasonRanks ? rank != null : null,
    } satisfies EvaluationContext;
  });

  contextCache.set(cacheKey, { at: Date.now(), contexts, warnings });
  return { contexts, warnings };
}

async function seasonRanksFor(program: RewardProgram): Promise<Map<string, number> | null> {
  if (!program.seasonId) return null;
  try {
    const lbStore = await import("@/lib/leaderboard/leaderboard-store.server");
    const season = await lbStore.getSeasonById(program.seasonId);
    if (!season) return null;
    const stored = await lbStore.seasonStandings(season.id);
    if (stored.standings.length) {
      return new Map(stored.standings.map((s) => [s.creatorAddress.toLowerCase(), s.rank]));
    }
    const engine = await import("@/lib/leaderboard/leaderboard-engine.server");
    const live = await engine.computeSeasonEntries(season);
    return new Map(live.entries.map((e) => [e.address.toLowerCase(), e.rank]));
  } catch {
    return null;
  }
}

async function seasonOf(program: RewardProgram) {
  if (!program.seasonId) return null;
  try {
    const lbStore = await import("@/lib/leaderboard/leaderboard-store.server");
    return await lbStore.getSeasonById(program.seasonId);
  } catch {
    return null;
  }
}

/* ------------------------------- evaluation -------------------------------- */

export async function evaluateProgram(program: RewardProgram): Promise<{
  evaluations: EligibilityEvaluation[];
  window: ResolvedWindow;
  warnings: string[];
}> {
  const season = await seasonOf(program);
  const window = resolveWindow(program, season ? { startsAt: season.startsAt, endsAt: season.endsAt } : null);
  const ranks = await seasonRanksFor(program);
  const { contexts, warnings } = await buildEvaluationContexts(program, window, ranks);
  const evaluations = contexts.map((c) => evaluateEligibility(c, program.rules)).sort(compareEvaluations);
  return { evaluations, window, warnings };
}

/* ------------------------------ public reads ------------------------------- */

async function toSummary(program: RewardProgram): Promise<RewardProgramSummary> {
  const season = await seasonOf(program);
  const stats = await store.programStats(ACTIVE_CHAIN_ID, program.id);
  return {
    ...program,
    status: effectiveProgramStatus(program),
    seasonSlug: season?.slug ?? null,
    seasonName: season?.name ?? null,
    evaluatedCreators: stats?.evaluated ?? null,
    eligibleCreators: stats?.eligible ?? null,
    lastEvaluatedAt: stats?.lastEvaluatedAt ?? null,
  };
}

/** Public `/rewards` listing: no PII, no exclusion lists, no secrets. */
export async function listPublicPrograms(): Promise<{
  programs: RewardProgramSummary[];
  chainId: number;
  storageReady: boolean;
  storageError: string | null;
}> {
  const ready = await store.rewardsReady();
  if (!ready.ready) {
    return { programs: [], chainId: ACTIVE_CHAIN_ID, storageReady: false, storageError: ready.error };
  }
  const all = await store.listPrograms(ACTIVE_CHAIN_ID);
  const visible = all.filter((p) => p.status !== "draft");
  const programs = await Promise.all(visible.map(toSummary));
  const order: Record<string, number> = { active: 0, scheduled: 1, ended: 2, archived: 3, draft: 4 };
  programs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return { programs, chainId: ACTIVE_CHAIN_ID, storageReady: true, storageError: null };
}

export async function getProgramView(slug: string): Promise<RewardProgramSummary | null> {
  const program = await store.getProgramBySlug(ACTIVE_CHAIN_ID, slug);
  if (!program || program.status === "draft") return null;
  return toSummary(program);
}

/** §27 — public eligibility table with filters and pagination. */
export async function getEligibilityPage(opts: {
  slug: string;
  filter?: EligibilityStatus | "all";
  page?: number;
  pageSize?: number;
}): Promise<EligibilityPage> {
  const { page, pageSize } = clampPagination(opts.page, opts.pageSize);
  const filter = opts.filter ?? "all";
  const ready = await store.rewardsReady();
  const empty: EligibilityPage = {
    program: null,
    entries: [],
    total: 0,
    page,
    pageSize,
    filter,
    counts: { eligible: 0, not_eligible: 0, pending: 0, excluded: 0 },
    chainId: ACTIVE_CHAIN_ID,
    evaluatedAt: new Date().toISOString(),
    updating: false,
    storageReady: ready.ready,
    storageError: ready.error,
  };
  if (!ready.ready) return empty;

  const program = await store.getProgramBySlug(ACTIVE_CHAIN_ID, opts.slug);
  if (!program || program.status === "draft") return empty;

  let evaluations: EligibilityEvaluation[] = [];
  let warnings: string[] = [];
  try {
    const res = await evaluateProgram(program);
    evaluations = res.evaluations;
    warnings = res.warnings;
  } catch (e) {
    return { ...empty, program: await toSummary(program), updating: true, storageError: e instanceof Error ? e.message : null };
  }

  const counts = countStatuses(evaluations);
  const filtered = filter === "all" ? evaluations : evaluations.filter((e) => e.status === filter);
  const ranked = filtered.map((e, i) => ({ ...e, rank: i + 1 }));

  return {
    ...empty,
    program: await toSummary(program),
    entries: paginate(ranked, page, pageSize),
    total: ranked.length,
    counts,
    updating: warnings.length > 0,
  };
}

/** 🎁 Rewards block of `/creator/:address` (§25). */
export async function getCreatorRewards(addressInput: string): Promise<CreatorRewardsSummary> {
  const address = normalizeAddress(addressInput);
  const ready = await store.rewardsReady();
  const summary: CreatorRewardsSummary = {
    address,
    chainId: ACTIVE_CHAIN_ID,
    programs: [],
    storageReady: ready.ready,
    storageError: ready.error,
  };
  if (!ready.ready) return summary;

  const programs = (await store.listPrograms(ACTIVE_CHAIN_ID)).filter(
    (p) => p.status === "active" || p.status === "scheduled" || p.status === "ended",
  );

  for (const program of programs.slice(0, 6)) {
    try {
      const season = await seasonOf(program);
      const window = resolveWindow(program, season ? { startsAt: season.startsAt, endsAt: season.endsAt } : null);
      const ranks = await seasonRanksFor(program);
      const { contexts } = await buildEvaluationContexts(program, window, ranks);
      const ctx = contexts.find((c) => c.address === address);
      if (!ctx) continue;
      const evaluation = evaluateEligibility(ctx, program.rules);
      const snapshot = await store.latestSnapshotFor(ACTIVE_CHAIN_ID, program.id, address);
      summary.programs.push({
        slug: program.slug,
        name: program.name,
        status: effectiveProgramStatus(program),
        seasonName: season?.name ?? null,
        endsAt: program.endsAt,
        evaluation,
        snapshotAt: snapshot?.evaluatedAt ?? null,
        ruleVersion: program.ruleVersion,
      });
    } catch {
      /* one failing program never blanks the whole block */
    }
  }
  return summary;
}

/* ---------------------------------- engine --------------------------------- */

/**
 * Evaluates every active program (or one specific program) and writes
 * append-only snapshots. `dryRun` NEVER writes (§36).
 */
export async function runRewardsEngine(
  trigger: string,
  opts: { dryRun?: boolean; backfill?: boolean; programId?: string } = {},
): Promise<RewardsRunResult> {
  const dryRun = opts.dryRun ?? false;
  const scope = opts.programId ? `program:${opts.programId}` : opts.backfill ? "backfill" : "run";
  const lock = await acquireRewardsLock(scope);
  if (!lock.acquired) {
    const state = await loadRewardsState();
    return { state, dryRun, skipped: true, skippedReason: `Otra ejecución está en curso desde ${lock.heldSince ?? "?"}.` };
  }

  const started = Date.now();
  const state: RewardsEngineState = {
    ...EMPTY_REWARDS_STATE,
    runId: crypto.randomUUID(),
    trigger,
    startedAt: new Date(started).toISOString(),
    notes: [],
  };

  try {
    const all = await store.listPrograms(ACTIVE_CHAIN_ID);
    const targets = opts.programId
      ? all.filter((p) => p.id === opts.programId)
      : all.filter((p) => effectiveProgramStatus(p) === "active");

    if (!targets.length) {
      const reason = opts.programId
        ? "PROGRAM_NOT_FOUND: El programa solicitado no existe en la red activa."
        : "NO_ACTIVE_PROGRAM: No hay programas activos que evaluar. Crea y activa un Reward Program antes de ejecutar el Preview.";
      state.notes.push(reason);
      state.finishedAt = new Date().toISOString();
      state.durationMs = Date.now() - started;
      return { state, dryRun, skipped: true, skippedReason: reason };
    }

    const evaluatedAt = evaluationBucket();

    for (const program of targets) {
      try {
        const { evaluations, window, warnings } = await evaluateProgram(program);
        state.programsEvaluated += 1;
        state.creatorsEvaluated += evaluations.length;
        const counts = countStatuses(evaluations);
        state.eligible += counts.eligible;
        state.notEligible += counts.not_eligible;
        state.pending += counts.pending;
        state.excluded += counts.excluded;
        for (const w of warnings) state.notes.push(`PENDING_DATA: ${program.name}: ${w} — criterio marcado como N/A.`);
        if (!evaluations.length) {
          state.notes.push(
            `NO_CREATORS: ${program.name}: el Creator Index no devolvió creators para la red activa. Revisa el Trending/Creator Index antes de interpretar el resultado.`,
          );
        }

        if (dryRun || !evaluations.length) continue;

        const rows = await Promise.all(
          evaluations.map(async (e) => ({
            chainId: ACTIVE_CHAIN_ID,
            programId: program.id,
            ruleVersion: program.ruleVersion,
            creatorAddress: e.address,
            status: e.status,
            eligible: e.status === "eligible",
            eligibilityScore: e.eligibilityScore,
            points: e.metrics.points,
            creatorScore: e.metrics.score,
            creatorLevel: e.metrics.level,
            achievements: e.metrics.achievements,
            graduations: e.metrics.graduations,
            organicScore: e.metrics.organic,
            seasonRank: e.metrics.seasonRank,
            criteriaResult: { criteria: e.criteria, exclusions: e.exclusionReasons, missing: e.missingCriteria },
            riskFlags: e.riskFlags,
            evaluationWindow: program.evaluationWindow,
            evaluationStart: window.start,
            evaluationEnd: window.end,
            evaluatedAt,
            fingerprint: await sha256(
              eligibilityFingerprintInput({
                chainId: ACTIVE_CHAIN_ID,
                programId: program.id,
                ruleVersion: program.ruleVersion,
                creatorAddress: e.address,
                windowKey: window.key,
                evaluatedAt,
              }),
            ),
          })),
        );
        const res = await store.appendEligibilitySnapshots(rows);
        state.snapshotsCreated += res.inserted;
        state.duplicates += res.duplicates;
        if (res.error) {
          state.errors += 1;
          state.lastError = res.error;
        }
      } catch (e) {
        state.errors += 1;
        state.lastError = e instanceof Error ? e.message : "evaluación fallida";
        state.notes.push(`${program.name}: ${state.lastError}`);
      }
    }

    state.finishedAt = new Date().toISOString();
    state.durationMs = Date.now() - started;
    if (!state.errors) state.lastSuccessAt = state.finishedAt;
    if (!dryRun) await saveRewardsState(state);
    return { state, dryRun, skipped: false, skippedReason: null };
  } catch (e) {
    state.errors += 1;
    state.lastError = e instanceof Error ? e.message : "fallo del motor";
    state.finishedAt = new Date().toISOString();
    state.durationMs = Date.now() - started;
    if (!dryRun) await saveRewardsState(state);
    return { state, dryRun, skipped: false, skippedReason: null };
  } finally {
    await releaseRewardsLock(scope, lock.token);
  }
}
