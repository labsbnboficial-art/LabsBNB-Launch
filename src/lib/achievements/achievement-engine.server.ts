// 🏆 Creator Achievements Engine (Fase 2D) — server only.
//
// Consumes the EXISTING creator/trending pipeline (no duplicated indexing, no
// new RPC load): Creator Service (profiles + tokens), `trending_snapshots`
// history, `creator_points_ledger` totals and `creator_level_history`.
//
// Guarantees:
//   • Only real data. A metric that cannot be verified → no unlock.
//   • Idempotent: SHA-256 fingerprint + UNIQUE index; concurrent runs are safe.
//   • Append-only: a threshold change never revokes a past unlock.
//   • Zero Creator Points are awarded here.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  DEFAULT_ACHIEVEMENTS_CONFIG,
  type AchievementEntry,
  type AchievementView,
  type AchievementsConfig,
  type AchievementsRunResult,
  type CreatorAchievementsSummary,
} from "./achievement-types";
import {
  evaluateAchievementRule,
  evaluateCreatorContext,
  normalizeAddress,
  type AchievementContext,
  type AchievementTokenFacts,
} from "./achievement-rules";
import {
  acquireAchievementsLock,
  loadAchievementsConfig,
  releaseAchievementsLock,
  saveAchievementsState,
} from "./achievement-config.server";
import {
  achievementsByCreator,
  achievementsReady,
  getCreatorAchievementRows,
  recordAchievement,
} from "./achievement-history.server";
import type { CreatorProfile } from "@/lib/creator/creator-types";
import type { TokenTrendingHistory } from "@/lib/creator/creator-types";

/* ------------------------------ fact building ------------------------------ */

function tokenFacts(profile: CreatorProfile, histories: Map<string, TokenTrendingHistory>): AchievementTokenFacts[] {
  return profile.tokens.map((t) => {
    const h = histories.get(t.address.toLowerCase());
    const nearGraduation = h?.events.find((e) => e.kind === "near_graduation")?.at ?? null;
    return {
      address: t.address,
      symbol: t.symbol,
      createdAt: t.createdAt,
      holders: t.holders,
      bondingProgress: t.bondingProgress,
      graduated: t.graduated,
      graduatedAt: t.graduatedAt,
      bestTrendingRank: t.bestTrendingRank ?? h?.bestRank ?? null,
      bestTrendingScore: h?.bestScore ?? null,
      top5Appearances: h?.top5 ?? 0,
      nearGraduationAt: nearGraduation,
      organicScore: t.organicScore,
      whaleTrades: t.whaleTrades,
      buyers: t.buyers,
      // The launchpad `tokens` table does not persist the creation tx hash for
      // every token: absent → null (never fabricated).
      creationTx: null,
      creationBlock: null,
    } satisfies AchievementTokenFacts;
  });
}

async function creatorLevelOf(address: string): Promise<{ level: number | null; milestones: number[] }> {
  try {
    const [store, cfgMod, rules, history] = await Promise.all([
      import("@/lib/points/points-store.server"),
      import("@/lib/levels/levels-config.server"),
      import("@/lib/levels/levels-rules"),
      import("@/lib/levels/level-history.server"),
    ]);
    const [totals, cfg] = await Promise.all([
      store.creatorTotals(ACTIVE_CHAIN_ID, address),
      cfgMod.loadLevelsConfig(),
    ]);
    if (!cfg.enabled) return { level: null, milestones: [] };
    const level = rules.calculateCreatorLevel(totals.total, cfg).level;
    let milestones: number[] = [];
    try {
      milestones = (await history.getCreatorLevelHistory(address, ACTIVE_CHAIN_ID)).map((e) => e.newLevel);
    } catch {
      /* level history table not migrated yet */
    }
    return { level, milestones };
  } catch {
    return { level: null, milestones: [] };
  }
}

/* ------------------------------- public reads ------------------------------ */

function buildViews(
  config: AchievementsConfig,
  entries: AchievementEntry[],
  ctx: AchievementContext | null,
): AchievementView[] {
  const byKey = new Map(entries.map((e) => [e.achievementKey, e]));
  const views: AchievementView[] = config.definitions.map((def) => {
    const entry = byKey.get(def.key) ?? null;
    const evaluation = ctx ? evaluateAchievementRule(def.key, ctx, config) : null;
    return {
      ...def,
      unlocked: !!entry,
      unlockedAt: entry?.unlockedAt ?? null,
      evidence: entry?.evidence ?? null,
      progress: entry ? null : (evaluation?.progress ?? null),
      legacy: false,
    };
  });
  // Unlocks whose definition was removed from the catalog stay visible as legacy.
  const known = new Set(config.definitions.map((d) => d.key));
  for (const entry of entries) {
    if (known.has(entry.achievementKey)) continue;
    views.push({
      key: entry.achievementKey,
      name: entry.achievementKey,
      description: "Logro histórico retirado del catálogo activo.",
      icon: "🏆",
      category: "elite",
      rarity: "rare",
      enabled: false,
      displayOrder: 9_999,
      ruleConfig: {},
      unlocked: true,
      unlockedAt: entry.unlockedAt,
      evidence: entry.evidence,
      progress: null,
      legacy: true,
    });
  }
  return views.sort((a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key));
}

/** Catalog + unlock state of one creator (public read, no writes). */
export async function getCreatorAchievements(
  addressInput: string,
  chainId: number = ACTIVE_CHAIN_ID,
): Promise<CreatorAchievementsSummary> {
  const creator = normalizeAddress(addressInput);
  const config = await loadAchievementsConfig();
  const ready = await achievementsReady();
  let entries: AchievementEntry[] = [];
  if (ready.ready) {
    try {
      entries = await getCreatorAchievementRows(creator, chainId);
    } catch (e) {
      return {
        creator,
        chainId,
        achievements: buildViews(config, [], null),
        totalAchievements: config.definitions.length,
        unlockedAchievements: 0,
        completionPercentage: 0,
        storageReady: false,
        storageError: e instanceof Error ? e.message : "read failed",
      };
    }
  }

  // Live progress for locked achievements (never persisted here).
  let ctx: AchievementContext | null = null;
  try {
    const [service, store] = await Promise.all([
      import("@/lib/creator/creator-service.server"),
      import("@/lib/creator/creator-store.server"),
    ]);
    const { profile } = await service.getCreatorProfile(creator);
    if (profile) {
      const histories = await store.loadTrendingHistory(chainId);
      const level = await creatorLevelOf(creator);
      ctx = {
        chainId,
        creatorAddress: creator,
        tokens: tokenFacts(profile, histories),
        creatorLevel: level.level,
        levelMilestones: level.milestones,
        unlockedKeys: new Set(entries.map((e) => e.achievementKey)),
      };
    }
  } catch {
    /* progress unavailable → UI shows the unlock state only */
  }

  const achievements = buildViews(config, entries, ctx);
  const total = achievements.filter((a) => !a.legacy).length;
  const unlocked = achievements.filter((a) => a.unlocked).length;
  return {
    creator,
    chainId,
    achievements,
    totalAchievements: total,
    unlockedAchievements: unlocked,
    completionPercentage: total ? Math.round((achievements.filter((a) => a.unlocked && !a.legacy).length / total) * 100) : 0,
    storageReady: ready.ready,
    storageError: ready.error,
  };
}

/** Compact badges for list views — ONE query for the whole page (no N+1). */
export async function achievementBadgesFor(
  addresses: string[],
  chainId: number = ACTIVE_CHAIN_ID,
): Promise<Map<string, { key: string; icon: string; name: string; rarity: string }[]>> {
  const out = new Map<string, { key: string; icon: string; name: string; rarity: string }[]>();
  const ready = await achievementsReady();
  if (!ready.ready || !addresses.length) return out;
  const config = await loadAchievementsConfig();
  const defs = new Map(config.definitions.map((d) => [d.key, d]));
  const rows = await achievementsByCreator(addresses, chainId);
  for (const [creator, entries] of rows) {
    out.set(
      creator,
      entries.map((e) => {
        const def = defs.get(e.achievementKey);
        return {
          key: e.achievementKey,
          icon: def?.icon ?? "🏆",
          name: def?.name ?? e.achievementKey,
          rarity: def?.rarity ?? "rare",
        };
      }),
    );
  }
  return out;
}

/* --------------------------------- engine ---------------------------------- */

/** Evaluates ONE creator and persists the new unlocks. Returns the deltas. */
export async function evaluateCreatorAchievements(
  profile: CreatorProfile,
  deps: {
    config: AchievementsConfig;
    histories: Map<string, TokenTrendingHistory>;
    unlocked: Set<string>;
    chainId: number;
    backfill?: boolean;
    dryRun?: boolean;
  },
): Promise<{ inserted: number; duplicates: number; detected: number }> {
  const level = await creatorLevelOf(profile.address);
  const ctx: AchievementContext = {
    chainId: deps.chainId,
    creatorAddress: profile.address,
    tokens: tokenFacts(profile, deps.histories),
    creatorLevel: level.level,
    levelMilestones: level.milestones,
    unlockedKeys: deps.unlocked,
  };
  const { candidates } = await evaluateCreatorContext(ctx, deps.config, { backfill: deps.backfill ?? false });
  if (!candidates.length || deps.dryRun) return { inserted: 0, duplicates: 0, detected: candidates.length };
  const { inserted, duplicates } = await recordAchievement(candidates);
  return { inserted, duplicates, detected: candidates.length };
}

/**
 * Full run over every known creator. Reuses the Creator ecosystem cron (it is
 * called right after the Creator Points Engine), so no new cron is required.
 */
export async function runAchievementsEngine(
  trigger: string,
  opts: { backfill?: boolean; dryRun?: boolean; chainId?: number } = {},
): Promise<AchievementsRunResult> {
  const started = Date.now();
  const runId = crypto.randomUUID().slice(0, 8);
  const chainId = opts.chainId ?? ACTIVE_CHAIN_ID;
  const base: AchievementsRunResult = {
    runId,
    lastRunAt: new Date().toISOString(),
    lastTrigger: trigger,
    creatorsEvaluated: 0,
    achievementsUnlocked: 0,
    duplicates: 0,
    errors: 0,
    durationMs: 0,
    notes: [],
    skipped: false,
    skippedReason: null,
    backfill: !!opts.backfill,
  };

  const config = await loadAchievementsConfig();
  if (!config.enabled) {
    return { ...base, skipped: true, skippedReason: "Achievements deshabilitados por el admin.", durationMs: Date.now() - started };
  }
  const ready = await achievementsReady();
  if (!ready.ready) {
    return {
      ...base,
      skipped: true,
      skippedReason: `Tabla creator_achievements no disponible: ${ready.error ?? "desconocido"}. Ejecuta docs/SQL_CREATOR_ACHIEVEMENTS.md.`,
      durationMs: Date.now() - started,
    };
  }

  const lock = await acquireAchievementsLock(trigger);
  if (!lock.acquired) {
    return {
      ...base,
      skipped: true,
      skippedReason: `Otra ejecución está en curso (desde ${lock.heldSince ?? "hace poco"}).`,
      durationMs: Date.now() - started,
    };
  }

  const result = { ...base };
  try {
    const [service, store] = await Promise.all([
      import("@/lib/creator/creator-service.server"),
      import("@/lib/creator/creator-store.server"),
    ]);
    const { profiles } = await service.getCreatorIndex();
    const histories = await store.loadTrendingHistory(chainId);
    const existing = await achievementsByCreator(
      profiles.map((p) => p.address),
      chainId,
    );

    for (const profile of profiles) {
      try {
        const unlocked = new Set((existing.get(profile.address.toLowerCase()) ?? []).map((e) => e.achievementKey));
        const r = await evaluateCreatorAchievements(profile, {
          config,
          histories,
          unlocked,
          chainId,
          backfill: opts.backfill,
          dryRun: opts.dryRun,
        });
        result.creatorsEvaluated += 1;
        result.achievementsUnlocked += r.inserted;
        result.duplicates += r.duplicates;
      } catch (e) {
        result.errors += 1;
        result.notes.push(`${profile.address}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  } catch (e) {
    result.errors += 1;
    result.notes.push(e instanceof Error ? e.message : "run failed");
  } finally {
    await releaseAchievementsLock(lock.token);
  }

  result.durationMs = Date.now() - started;
  result.notes = result.notes.slice(0, 10);
  if (!opts.dryRun) await saveAchievementsState({ ...result });
  console.info(
    `[CREATOR_ACHIEVEMENTS] run ${runId} (${trigger}${opts.backfill ? ", backfill" : ""}) — creators ${result.creatorsEvaluated} · unlocked ${result.achievementsUnlocked} · duplicates ${result.duplicates} · errors ${result.errors} · ${result.durationMs}ms`,
  );
  return result;
}

/** One-shot historical reconstruction. Idempotent: safe to run many times. */
export async function backfillCreatorAchievements(chainId = ACTIVE_CHAIN_ID) {
  return runAchievementsEngine("admin-backfill", { backfill: true, chainId });
}

export const ACHIEVEMENTS_DEFAULT_CONFIG = DEFAULT_ACHIEVEMENTS_CONFIG;
