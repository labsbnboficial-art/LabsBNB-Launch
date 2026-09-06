// 🏆 Fase 2E — Creator Leaderboard + Seasons engine (server only).
//
// This engine CREATES NOTHING new: it reads the existing Creator Index
// (Creator Profiles + Creator Score), the Creator Points ledger, Creator
// Levels, Achievements and `trending_snapshots`, and produces a deterministic
// ranking plus append-only snapshots.
//
//   • no new points system            • no new trending engine
//   • no contract calls               • no per-creator RPC (index is cached)
//   • unavailable metric → null       • weight redistributed, never faked
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  assignRanks,
  compareByCategory,
  countdown,
  effectiveSeasonStatus,
  leaderboardFingerprintInput,
  normalizeAddress,
  organicMetric,
  paginate,
  scoreCandidates,
  seasonFingerprintInput,
  seasonWeights,
  sha256,
  snapshotBucket,
  trendingMetric,
  withinSeason,
} from "./leaderboard-rules";
import {
  DEFAULT_LEADERBOARD_WEIGHTS,
  EMPTY_LEADERBOARD_STATE,
  type CreatorLeaderboardSummary,
  type CreatorSeason,
  type LeaderboardCandidate,
  type LeaderboardCategory,
  type LeaderboardEngineState,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LeaderboardRunResult,
  type SeasonSummary,
} from "./leaderboard-types";
import {
  acquireLeaderboardLock,
  loadLeaderboardState,
  releaseLeaderboardLock,
  saveLeaderboardState,
} from "./leaderboard-config.server";
import * as store from "./leaderboard-store.server";

/* --------------------------------- caching --------------------------------- */

const CANDIDATE_TTL_MS = 45_000; // §36 — 30–60s server-side cache
let candidateCache: { at: number; candidates: LeaderboardCandidate[]; source: string; warnings: string[] } | null = null;

export function resetLeaderboardCache() {
  candidateCache = null;
}

/* ------------------------------- candidates -------------------------------- */

/**
 * Builds the candidate set from the cached Creator Index. Every optional data
 * source degrades independently: if Points, Achievements or Trending fail, the
 * leaderboard still renders and the affected metric becomes `null`.
 */
export async function buildCandidates(): Promise<{
  candidates: LeaderboardCandidate[];
  source: string;
  warnings: string[];
}> {
  if (candidateCache && Date.now() - candidateCache.at < CANDIDATE_TTL_MS) {
    return { candidates: candidateCache.candidates, source: "cache", warnings: candidateCache.warnings };
  }

  const warnings: string[] = [];
  const creatorService = await import("@/lib/creator/creator-service.server");
  const { profiles, source } = await creatorService.getCreatorIndex();

  // Creator Points — ONE aggregated query (no N+1).
  let points: Map<string, number> | null = null;
  try {
    const pointsStore = await import("@/lib/points/points-store.server");
    const ready = await pointsStore.ledgerReady();
    if (ready.ready) points = await pointsStore.totalsByCreator(ACTIVE_CHAIN_ID);
    else warnings.push("Creator Points unavailable");
  } catch {
    warnings.push("Creator Points unavailable");
  }

  // Creator Levels — read-only, thresholds untouched.
  let levelsConfig: Awaited<ReturnType<typeof import("@/lib/levels/levels-config.server").loadLevelsConfig>> | null =
    null;
  try {
    const cfgMod = await import("@/lib/levels/levels-config.server");
    levelsConfig = await cfgMod.loadLevelsConfig();
  } catch {
    warnings.push("Creator Levels unavailable");
  }
  const { calculateCreatorLevel } = await import("@/lib/levels/levels-rules");

  // Achievements — ONE batched query for every creator (no N+1).
  let badges = new Map<string, { key: string; icon: string; name: string; rarity: string }[]>();
  try {
    const ac = await import("@/lib/achievements/achievement-engine.server");
    badges = await ac.achievementBadgesFor(
      profiles.map((p) => p.address),
      ACTIVE_CHAIN_ID,
    );
  } catch {
    warnings.push("Achievements unavailable");
  }

  const candidates: LeaderboardCandidate[] = profiles.map((p) => {
    const creatorPoints = points ? (points.get(p.address) ?? 0) : null;
    const lvl =
      levelsConfig?.enabled && creatorPoints != null ? calculateCreatorLevel(creatorPoints, levelsConfig) : null;
    const hasTrendingHistory =
      p.stats.bestTrendingRank != null ||
      p.stats.top5Count > 0 ||
      p.stats.top10Count > 0 ||
      p.stats.risingCount > 0;
    const whaleTrades = p.tokens.reduce((s, t) => s + (t.whaleTrades ?? 0), 0);
    return {
      address: p.address,
      displayName: p.customization.displayName,
      avatarUrl: p.customization.avatarUrl,
      level: lvl ? { level: lvl.level, name: lvl.name, icon: lvl.icon } : null,
      raw: {
        points: creatorPoints,
        score: p.score,
        graduations: p.stats.graduatedTokens,
        trending: trendingMetric({
          top5: p.stats.top5Count,
          top10: p.stats.top10Count,
          risingFast: p.stats.risingCount,
          bestRank: p.stats.bestTrendingRank,
          hasHistory: hasTrendingHistory,
        }),
        organic: organicMetric(p.stats.organicVolume24h),
      },
      extras: {
        tokensCreated: p.stats.tokensCreated,
        uniqueBuyers: p.stats.uniqueBuyers,
        holders: p.stats.holders,
        whaleTrades,
        risingCount: p.stats.risingCount,
        top5: p.stats.top5Count,
        top10: p.stats.top10Count,
        bestTrendingRank: p.stats.bestTrendingRank,
        organicVolume24h: p.stats.organicVolume24h,
      },
      achievementBadges: badges.get(p.address.toLowerCase()) ?? [],
    };
  });

  candidateCache = { at: Date.now(), candidates, source, warnings };
  return { candidates, source, warnings };
}

/* ------------------------------ public reads ------------------------------- */

export async function getLeaderboardPage(opts: {
  category?: LeaderboardCategory;
  page?: number;
  pageSize?: number;
}): Promise<LeaderboardPage> {
  const category = opts.category ?? "overall";
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize ?? 25)));

  let candidates: LeaderboardCandidate[] = [];
  let source = "live";
  let updating = false;
  try {
    const built = await buildCandidates();
    candidates = built.candidates;
    source = built.source;
    updating = built.warnings.length > 0;
  } catch {
    // §37 — an RPC 429/timeout must not blank the page.
    updating = true;
    source = "unavailable";
  }

  const { scored, unavailableMetrics } = scoreCandidates(candidates, DEFAULT_LEADERBOARD_WEIGHTS);
  const ordered = category === "overall" ? scored : [...scored].sort(compareByCategory(category));
  const history = await store.rankHistory(ACTIVE_CHAIN_ID).catch(() => new Map());
  const ranked = assignRanks(ordered, history);

  return {
    entries: paginate(ranked, page, pageSize),
    top3: ranked.slice(0, 3),
    total: ranked.length,
    page,
    pageSize,
    category,
    chainId: ACTIVE_CHAIN_ID,
    unavailableMetrics,
    updating,
    updatedAt: new Date().toISOString(),
    source,
  };
}

/** Leaderboard block of `/creator/:address` (§15). */
export async function getCreatorLeaderboardSummary(addressInput: string): Promise<CreatorLeaderboardSummary> {
  const address = normalizeAddress(addressInput);
  const ready = await store.leaderboardReady();
  const base: CreatorLeaderboardSummary = {
    address,
    chainId: ACTIVE_CHAIN_ID,
    currentRank: null,
    previousRank: null,
    rankChange: null,
    bestRank: null,
    worstRank: null,
    overallScore: null,
    isNew: true,
    season: null,
    storageReady: ready.ready,
    storageError: ready.error,
  };

  const full = await getLeaderboardPage({ category: "overall", page: 1, pageSize: 100 });
  const all = full.total <= 100 ? full.entries : (await getLeaderboardPage({ category: "overall", page: 1, pageSize: 100 })).entries;
  const me = all.find((e) => e.address === address) ?? null;
  if (me) {
    base.currentRank = me.rank;
    base.previousRank = me.previousRank;
    base.rankChange = me.rankChange;
    base.bestRank = me.bestRank;
    base.overallScore = me.overallScore;
    base.isNew = me.isNew;
  }

  if (ready.ready) {
    const hist = await store.rankHistory(ACTIVE_CHAIN_ID);
    const h = hist.get(address);
    if (h) {
      base.bestRank = base.bestRank == null ? h.bestRank : Math.min(base.bestRank, h.bestRank ?? base.bestRank);
      base.worstRank = h.worstRank;
    }
    const season = await store.getActiveSeason(ACTIVE_CHAIN_ID);
    if (season) {
      const standings = await store.seasonStandings(season.id);
      const mine = standings.standings.find((s) => s.creatorAddress.toLowerCase() === address) ?? null;
      base.season = {
        slug: season.slug,
        name: season.name,
        rank: mine?.rank ?? null,
        score: mine?.seasonScore ?? null,
        endsAt: season.endsAt,
      };
    }
  }
  return base;
}

/* --------------------------------- seasons --------------------------------- */

export async function getActiveSeasonView(): Promise<
  | (CreatorSeason & { participants: number; countdown: ReturnType<typeof countdown> })
  | null
> {
  const season = await store.getActiveSeason(ACTIVE_CHAIN_ID);
  if (!season) return null;
  const participants = await store.seasonParticipants(season.id);
  return { ...season, participants, countdown: countdown(season.endsAt) };
}

export async function listSeasonSummaries(): Promise<SeasonSummary[]> {
  const seasons = await store.listSeasons(ACTIVE_CHAIN_ID);
  const out: SeasonSummary[] = [];
  for (const s of seasons) {
    const [participants, standings] = await Promise.all([
      store.seasonParticipants(s.id),
      store.seasonStandings(s.id),
    ]);
    out.push({
      ...s,
      status: effectiveSeasonStatus(s),
      participants,
      top3: standings.standings.slice(0, 3).map((x) => ({
        address: x.creatorAddress,
        rank: x.rank,
        score: x.seasonScore,
        displayName: null,
      })),
    });
  }
  return out;
}

/**
 * Season standings. Uses stored snapshots when they exist (immutable history),
 * otherwise computes them live from the season window.
 */
export async function getSeasonDetail(slug: string): Promise<{
  season: SeasonSummary | null;
  standings: LeaderboardEntry[];
  final: boolean;
  snapshotAt: string | null;
  updating: boolean;
}> {
  const season = await store.getSeasonBySlug(ACTIVE_CHAIN_ID, slug);
  if (!season) return { season: null, standings: [], final: false, snapshotAt: null, updating: false };

  const stored = await store.seasonStandings(season.id);
  const participants = await store.seasonParticipants(season.id);
  const summary: SeasonSummary = {
    ...season,
    status: effectiveSeasonStatus(season),
    participants,
    top3: [],
  };

  if (stored.final) {
    const entries = await hydrateStandings(stored.standings);
    summary.top3 = entries.slice(0, 3).map((e) => ({
      address: e.address,
      rank: e.rank,
      score: e.overallScore,
      displayName: e.displayName,
    }));
    return { season: summary, standings: entries, final: true, snapshotAt: stored.snapshotAt, updating: false };
  }

  const live = await computeSeasonEntries(season).catch(() => ({ entries: [], updating: true }));
  summary.top3 = live.entries.slice(0, 3).map((e) => ({
    address: e.address,
    rank: e.rank,
    score: e.overallScore,
    displayName: e.displayName,
  }));
  summary.participants = participants || live.entries.length;
  return {
    season: summary,
    standings: live.entries,
    final: false,
    snapshotAt: stored.snapshotAt,
    updating: live.updating,
  };
}

/** Re-attaches display data (level, badges, name) to a stored final ranking. */
async function hydrateStandings(standings: store.SeasonStanding[]): Promise<LeaderboardEntry[]> {
  let byAddress = new Map<string, LeaderboardCandidate>();
  try {
    const { candidates } = await buildCandidates();
    byAddress = new Map(candidates.map((c) => [c.address, c]));
  } catch {
    /* display data unavailable → the immutable ranking still renders */
  }
  return standings.map((s) => {
    const address = s.creatorAddress.toLowerCase();
    const c = byAddress.get(address);
    return {
      address,
      displayName: c?.displayName ?? null,
      avatarUrl: c?.avatarUrl ?? null,
      level: c?.level ?? null,
      raw: {
        points: s.creatorPoints,
        score: s.creatorScore,
        graduations: s.graduations,
        trending: s.trendingMetric,
        organic: s.organicMetric,
      },
      extras: c?.extras ?? {
        tokensCreated: 0,
        uniqueBuyers: null,
        holders: null,
        whaleTrades: null,
        risingCount: null,
        top5: null,
        top10: null,
        bestTrendingRank: null,
        organicVolume24h: null,
      },
      achievementBadges: c?.achievementBadges ?? [],
      rank: s.rank,
      overallScore: s.seasonScore,
      components: { points: null, score: null, graduations: null, trending: null, organic: null },
      missingMetrics: [],
      previousRank: null,
      rankChange: null,
      isNew: false,
      bestRank: s.rank,
    } satisfies LeaderboardEntry;
  });
}

/**
 * Season ranking computed ONLY from events inside `[starts_at, ends_at)`.
 * Activity before the season start is never attributed retroactively (§19).
 */
export async function computeSeasonEntries(
  season: CreatorSeason,
): Promise<{ entries: LeaderboardEntry[]; updating: boolean }> {
  const { candidates, warnings } = await buildCandidates();
  const creatorService = await import("@/lib/creator/creator-service.server");
  const { profiles } = await creatorService.getCreatorIndex();
  const byAddress = new Map(profiles.map((p) => [p.address, p]));

  // Season points: the existing ledger filtered by the window (never duplicated).
  let seasonPoints: Map<string, number> | null = null;
  try {
    const pointsStore = await import("@/lib/points/points-store.server");
    const ready = await pointsStore.ledgerReady();
    if (ready.ready) seasonPoints = await pointsStore.seasonTotalsByCreator(ACTIVE_CHAIN_ID, season.startsAt, season.endsAt);
  } catch {
    seasonPoints = null;
  }

  // Season trending: the existing `trending_snapshots` filtered by the window.
  let windowTrending: Map<string, { top5: number; top10: number; risingFast: number; bestRank: number | null }> | null =
    null;
  try {
    const creatorStore = await import("@/lib/creator/creator-store.server");
    windowTrending = await creatorStore.trendingCountsInWindow(ACTIVE_CHAIN_ID, season.startsAt, season.endsAt);
  } catch {
    windowTrending = null;
  }

  const seasonCandidates: LeaderboardCandidate[] = candidates.map((c) => {
    const profile = byAddress.get(c.address);
    const tokens = profile?.tokens ?? [];

    const graduations = tokens.filter((t) => t.graduatedAt && withinSeason(t.graduatedAt, season)).length;

    let trending: number | null = null;
    if (windowTrending) {
      let top5 = 0;
      let top10 = 0;
      let rising = 0;
      let best: number | null = null;
      let seen = false;
      for (const t of tokens) {
        const w = windowTrending.get(t.address.toLowerCase());
        if (!w) continue;
        seen = true;
        top5 += w.top5;
        top10 += w.top10;
        rising += w.risingFast;
        if (w.bestRank != null && (best == null || w.bestRank < best)) best = w.bestRank;
      }
      trending = trendingMetric({ top5, top10, risingFast: rising, bestRank: best, hasHistory: seen });
    }

    return {
      ...c,
      raw: {
        points: seasonPoints ? (seasonPoints.get(c.address) ?? 0) : null,
        score: c.raw.score,
        graduations,
        trending,
        organic: c.raw.organic,
      },
    };
  });

  // Only creators with eligible activity inside the window participate (§27).
  const participating = seasonCandidates.filter(
    (c) => (c.raw.points ?? 0) > 0 || (c.raw.graduations ?? 0) > 0 || (c.raw.trending ?? 0) > 0,
  );
  const pool = participating.length ? participating : seasonCandidates;

  const { scored } = scoreCandidates(pool, seasonWeights(season.rules));
  return { entries: assignRanks(scored), updating: warnings.length > 0 };
}

/* ---------------------------------- engine --------------------------------- */

export async function runLeaderboardEngine(
  trigger: string,
  opts: { dryRun?: boolean; backfill?: boolean } = {},
): Promise<LeaderboardRunResult> {
  const dryRun = opts.dryRun ?? false;
  const scope = opts.backfill ? "backfill" : "run";
  const lock = await acquireLeaderboardLock(scope);
  if (!lock.acquired) {
    const state = await loadLeaderboardState();
    return { state, dryRun, skipped: true, skippedReason: `Otra ejecución está en curso desde ${lock.heldSince ?? "?"}.` };
  }

  const started = Date.now();
  const runId = crypto.randomUUID();
  const notes: string[] = [];
  let errors = 0;
  let lastError: string | null = null;
  let creatorsEvaluated = 0;
  let snapshotsCreated = 0;
  let seasonSnapshotsCreated = 0;
  let duplicates = 0;
  let seasonId: string | null = null;

  try {
    const { candidates, warnings } = await buildCandidates();
    notes.push(...warnings.map((w) => `${w} — peso redistribuido.`));
    const { scored, unavailableMetrics } = scoreCandidates(candidates, DEFAULT_LEADERBOARD_WEIGHTS);
    const ranked = assignRanks(scored, await store.rankHistory(ACTIVE_CHAIN_ID));
    creatorsEvaluated = ranked.length;
    if (unavailableMetrics.length) notes.push(`Métricas no disponibles: ${unavailableMetrics.join(", ")}.`);

    const snapshotAt = snapshotBucket();

    if (!dryRun && ranked.length) {
      const rows = await Promise.all(
        ranked.map(async (e) => ({
          chainId: ACTIVE_CHAIN_ID,
          creatorAddress: e.address,
          rank: e.rank,
          overallScore: e.overallScore,
          creatorPoints: e.raw.points,
          creatorScore: e.raw.score,
          graduations: e.raw.graduations,
          trendingMetric: e.raw.trending,
          organicMetric: e.raw.organic,
          components: e.components as Record<string, number | null>,
          snapshotAt,
          fingerprint: await sha256(
            leaderboardFingerprintInput({ chainId: ACTIVE_CHAIN_ID, creatorAddress: e.address, snapshotAt }),
          ),
        })),
      );
      const res = await store.appendLeaderboardSnapshots(rows);
      snapshotsCreated = res.inserted;
      duplicates += res.duplicates;
      if (res.error) {
        errors += 1;
        lastError = res.error;
      }
    }

    // Active season snapshot — reuses this same run (no new cron, §22).
    const season = await store.getActiveSeason(ACTIVE_CHAIN_ID);
    if (season) {
      seasonId = season.id;
      const { entries } = await computeSeasonEntries(season);
      if (!dryRun && entries.length) {
        const rows = await Promise.all(
          entries.map(async (e) => ({
            chainId: ACTIVE_CHAIN_ID,
            seasonId: season.id,
            creatorAddress: e.address,
            rank: e.rank,
            seasonScore: e.overallScore,
            overallScore: e.overallScore,
            creatorPoints: e.raw.points,
            creatorScore: e.raw.score,
            graduations: e.raw.graduations,
            trendingMetric: e.raw.trending,
            organicMetric: e.raw.organic,
            components: e.components as Record<string, number | null>,
            isFinal: false,
            snapshotAt,
            fingerprint: await sha256(
              seasonFingerprintInput({
                chainId: ACTIVE_CHAIN_ID,
                seasonId: season.id,
                creatorAddress: e.address,
                snapshotAt,
              }),
            ),
          })),
        );
        const res = await store.appendSeasonSnapshots(rows);
        seasonSnapshotsCreated = res.inserted;
        duplicates += res.duplicates;
        if (res.error) {
          errors += 1;
          lastError = res.error;
        }
      }
    }
  } catch (e) {
    errors += 1;
    lastError = e instanceof Error ? e.message : "error desconocido";
  } finally {
    await releaseLeaderboardLock(scope, lock.token);
  }

  const finished = Date.now();
  const state: LeaderboardEngineState = {
    ...EMPTY_LEADERBOARD_STATE,
    runId,
    trigger,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    lastSuccessAt: dryRun || errors ? (await loadLeaderboardState()).lastSuccessAt : new Date(finished).toISOString(),
    seasonId,
    creatorsEvaluated,
    snapshotsCreated,
    seasonSnapshotsCreated,
    duplicates,
    errors,
    lastError,
    durationMs: finished - started,
    notes,
  };
  if (!dryRun) await saveLeaderboardState(state);
  resetLeaderboardCache();

  console.log(
    `[CREATOR_LEADERBOARD] run ${runId} (${trigger}${dryRun ? ", dry-run" : ""}) — creators ${creatorsEvaluated} · snapshots ${snapshotsCreated} · season snapshots ${seasonSnapshotsCreated} · duplicates ${duplicates} · errors ${errors} · ${state.durationMs}ms`,
  );

  return { state, dryRun, skipped: false, skippedReason: null };
}

/**
 * Immutable final snapshot of a season (§23). Re-running is safe: the FINAL
 * fingerprint makes it idempotent and historical rows are never overwritten.
 */
export async function finalizeSeason(
  seasonId: string,
  trigger: string,
): Promise<{ inserted: number; duplicates: number; participants: number; error: string | null; skipped: boolean }> {
  const lock = await acquireLeaderboardLock(`season:${seasonId}`);
  if (!lock.acquired) {
    return { inserted: 0, duplicates: 0, participants: 0, error: "Finalización en curso.", skipped: true };
  }
  try {
    const season = await store.getSeasonById(seasonId);
    if (!season) return { inserted: 0, duplicates: 0, participants: 0, error: "Temporada inexistente.", skipped: true };

    const { entries } = await computeSeasonEntries(season);
    const snapshotAt = new Date().toISOString();
    const rows = await Promise.all(
      entries.map(async (e) => ({
        chainId: ACTIVE_CHAIN_ID,
        seasonId: season.id,
        creatorAddress: e.address,
        rank: e.rank,
        seasonScore: e.overallScore,
        overallScore: e.overallScore,
        creatorPoints: e.raw.points,
        creatorScore: e.raw.score,
        graduations: e.raw.graduations,
        trendingMetric: e.raw.trending,
        organicMetric: e.raw.organic,
        components: e.components as Record<string, number | null>,
        isFinal: true,
        snapshotAt,
        fingerprint: await sha256(
          seasonFingerprintInput({
            chainId: ACTIVE_CHAIN_ID,
            seasonId: season.id,
            creatorAddress: e.address,
            snapshotAt,
            final: true,
          }),
        ),
      })),
    );
    const res = await store.appendSeasonSnapshots(rows);
    console.log(
      `[CREATOR_LEADERBOARD] season finalized ${season.slug} (${trigger}) — participants ${entries.length} · inserted ${res.inserted} · duplicates ${res.duplicates}`,
    );
    return { inserted: res.inserted, duplicates: res.duplicates, participants: entries.length, error: res.error, skipped: false };
  } finally {
    await releaseLeaderboardLock(`season:${seasonId}`, lock.token);
  }
}
