// 🏆 LabsBNB Creator Points Engine — server-side, deterministic, idempotent.
//
// Pipeline per run:
//   1. single-flight lock (`admin_config`)                    → no parallel runs
//   2. Creator index (Factory `creatorOf` + Trending Engine)  → real creators
//   3. decoded `Trade(...)` logs per bonding curve            → real activity
//   4. eligibility + anti-farming                             → exclusions
//   5. organic multiplier + point calculation                 → points
//   6. sha256 fingerprint + append-only ledger                → idempotency
//
// Nothing is simulated. When a metric is unavailable the event is NOT awarded.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import { fetchRecentTradeEvents } from "@/lib/web3/curve-events";
import { withRpcTimeout } from "@/lib/web3/timeout";
import type { CreatorProfile, CreatorTokenRow } from "@/lib/creator/creator-types";
import {
  EMPTY_POINTS_STATE,
  type CreatorPointsConfig,
  type PointsCandidate,
  type PointsEngineState,
  type PointsEventType,
  type PointsExclusion,
  type PointsMetadata,
  type PointsRunResult,
} from "./points-types";
import {
  aggregateTrades,
  applyMultiplier,
  EVENT_REASON,
  fingerprint,
  milestoneReason,
  milestonesReached,
  organicMultiplier,
  utcDayKey,
  type TradeAggregate,
} from "./points-rules";
import {
  acquirePointsLock,
  loadPointsConfig,
  releasePointsLock,
  savePointsState,
} from "./points-config.server";
import { appendLedger, existingFingerprints, ledgerReady, todayPointsByTokenEvent } from "./points-store.server";

const TOKEN_TIMEOUT_MS = 45_000;
const MAX_TOKENS_PER_RUN = 40;

export type RunOptions = {
  dryRun?: boolean;
  /** Backfill window (ISO dates). Events without a known date are skipped. */
  startDate?: string | null;
  endDate?: string | null;
};

type TokenContext = {
  profile: CreatorProfile;
  token: CreatorTokenRow;
  curve: string | null;
  aggregate: TradeAggregate | null;
  occurredAt: Record<string, string | null>;
};

/* ------------------------------- candidates ------------------------------- */

function achievementFlags(ctx: TokenContext): Partial<Record<PointsEventType, string | null>> {
  const { token, profile } = ctx;
  const events = profile.timeline.filter((e) => e.token.toLowerCase() === token.address.toLowerCase());
  const at = (kind: string) => events.find((e) => e.kind === kind)?.at ?? null;

  const rank = token.bestTrendingRank;
  const flags: Partial<Record<PointsEventType, string | null>> = {};
  if (at("trending_top10") || (rank != null && rank <= 10)) flags.TRENDING_TOP10 = at("trending_top10");
  if (at("trending_top5") || (rank != null && rank <= 5)) flags.TRENDING_TOP5 = at("trending_top5");
  if (at("rising_fast")) flags.RISING_FAST = at("rising_fast");
  if (at("near_graduation") || (token.bondingProgress != null && token.bondingProgress >= 80)) {
    flags.NEAR_GRADUATION = at("near_graduation");
  }
  if (token.graduated || token.graduatedAt) flags.GRADUATED = token.graduatedAt ?? at("graduation");
  return flags;
}

async function buildCandidate(input: {
  cfg: CreatorPointsConfig;
  creator: string;
  eventType: PointsEventType;
  sourceId: string;
  sourceRef: string | null;
  token: CreatorTokenRow | null;
  basePoints: number;
  multiplier: number;
  reason: string;
  metadata: PointsMetadata;
}): Promise<PointsCandidate> {
  const tokenAddress = input.token ? input.token.address.toLowerCase() : null;
  const fp = await fingerprint({
    chainId: ACTIVE_CHAIN_ID,
    creatorAddress: input.creator,
    eventType: input.eventType,
    sourceId: input.sourceId,
    tokenAddress,
  });
  return {
    creatorAddress: input.creator,
    chainId: ACTIVE_CHAIN_ID,
    eventType: input.eventType,
    sourceId: input.sourceId,
    sourceRef: input.sourceRef,
    tokenAddress,
    basePoints: input.basePoints,
    multiplier: input.multiplier,
    points: applyMultiplier(input.basePoints, input.multiplier),
    reason: input.reason,
    metadata: input.metadata,
    fingerprint: fp,
  };
}

function inRange(occurredAt: string | null, opts: RunOptions): boolean {
  if (!opts.startDate && !opts.endDate) return true;
  if (!occurredAt) return false;
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return false;
  if (opts.startDate && t < Date.parse(`${opts.startDate}T00:00:00.000Z`)) return false;
  if (opts.endDate && t > Date.parse(`${opts.endDate}T23:59:59.999Z`)) return false;
  return true;
}

/* ---------------------------------- run ----------------------------------- */

export async function runCreatorPointsEngine(trigger: string, opts: RunOptions = {}): Promise<PointsRunResult> {
  const dryRun = opts.dryRun === true;
  const startedAtMs = Date.now();
  const runId = crypto.randomUUID();
  const notes: string[] = [];
  const cfg = await loadPointsConfig();

  const base: PointsEngineState = {
    ...EMPTY_POINTS_STATE,
    runId,
    lastTrigger: trigger,
    startedAt: new Date(startedAtMs).toISOString(),
    lastRunAt: new Date(startedAtMs).toISOString(),
  };

  if (!cfg.engine_enabled) {
    notes.push("Creator Points Engine desactivado desde el panel admin.");
    return { ok: false, dryRun, skipped: "disabled", state: { ...base, notes }, candidates: [], exclusions: [] };
  }

  const storage = await ledgerReady();
  if (!storage.ready && !dryRun) {
    notes.push(`Ledger no disponible: ${storage.error ?? "tabla creator_points_ledger inexistente"}.`);
    return { ok: false, dryRun, skipped: "storage", state: { ...base, notes }, candidates: [], exclusions: [] };
  }

  const lock = dryRun ? ({ acquired: true, token: "dry-run" } as const) : await acquirePointsLock(trigger);
  if (!lock.acquired) {
    notes.push(`Ya hay una ejecución en curso (desde ${lock.heldSince ?? "desconocido"}).`);
    return { ok: false, dryRun, skipped: "locked", state: { ...base, notes }, candidates: [], exclusions: [] };
  }

  let errors = 0;
  let lastError: string | null = null;
  const exclusions: PointsExclusion[] = [];
  const candidates: PointsCandidate[] = [];
  let tokensScanned = 0;
  let creatorsScanned = 0;

  try {
    const creatorService = await import("@/lib/creator/creator-service.server");
    const { profiles } = await creatorService.getCreatorIndex();
    creatorsScanned = profiles.length;

    // Curve addresses come from the Trending Engine ranking (already cached).
    const trending = await import("@/lib/trending/trending-engine.server");
    const { rows } = await trending.getRanking();
    const curveByToken = new Map(rows.map((r) => [r.address.toLowerCase(), r.curve]));

    const contexts: TokenContext[] = [];
    for (const profile of profiles) {
      for (const token of profile.tokens.slice(0, MAX_TOKENS_PER_RUN)) {
        contexts.push({
          profile,
          token,
          curve: curveByToken.get(token.address.toLowerCase()) ?? null,
          aggregate: null,
          occurredAt: {},
        });
      }
    }

    for (const ctx of contexts) {
      tokensScanned += 1;
      if (!ctx.curve) continue;
      try {
        const events = await withRpcTimeout(
          `points ${ctx.token.symbol}`,
          () => fetchRecentTradeEvents(ctx.curve as `0x${string}`, cfg.lookback_days),
          TOKEN_TIMEOUT_MS,
        );
        ctx.aggregate = aggregateTrades(events, ctx.profile.address);
      } catch (e) {
        errors += 1;
        lastError = `${ctx.token.symbol}: ${e instanceof Error ? e.message : "trade read failed"}`;
      }
    }

    // ------------------------- candidate generation -------------------------
    const creationsPerDay = new Map<string, number>();

    for (const ctx of contexts) {
      const { profile, token, aggregate } = ctx;
      const creator = profile.address;
      const organic = organicMultiplier(token.organicScore);
      const suspicious = aggregate?.suspicious ?? false;

      const push = async (
        eventType: PointsEventType,
        sourceId: string,
        basePoints: number,
        reason: string,
        metadata: PointsMetadata,
        occurredAt: string | null,
      ) => {
        const rule = cfg.events[eventType];
        if (!rule.enabled) return;
        if (!inRange(occurredAt, opts)) return;
        if (rule.minimum_activity > 0 && (aggregate?.trades ?? 0) < rule.minimum_activity) {
          exclusions.push({
            eventType,
            tokenAddress: token.address,
            creatorAddress: creator,
            reason: `Actividad real insuficiente (${aggregate?.trades ?? 0} trades).`,
          });
          return;
        }
        let multiplier = rule.apply_multiplier ? organic : 1;
        if (rule.apply_multiplier && suspicious) multiplier = 0;
        if (multiplier <= 0 || basePoints <= 0) {
          exclusions.push({
            eventType,
            tokenAddress: token.address,
            creatorAddress: creator,
            reason: suspicious
              ? (aggregate?.suspicionReason ?? "Actividad sospechosa detectada.")
              : `Organic Activity Score insuficiente (${token.organicScore}).`,
          });
          return;
        }
        candidates.push(
          await buildCandidate({
            cfg,
            creator,
            eventType,
            sourceId,
            sourceRef: occurredAt,
            token,
            basePoints,
            multiplier,
            reason,
            metadata: {
              tokenSymbol: token.symbol,
              tokenName: token.name,
              organicScore: token.organicScore,
              ...metadata,
            },
          }),
        );
      };

      // 1. TOKEN_CREATED (max N rewarded creations per creator per UTC day)
      const dayKey = token.createdAt ? `${creator}|${utcDayKey(token.createdAt)}` : `${creator}|unknown`;
      const usedToday = creationsPerDay.get(dayKey) ?? 0;
      if (usedToday >= cfg.max_token_creations_per_day) {
        exclusions.push({
          eventType: "TOKEN_CREATED",
          tokenAddress: token.address,
          creatorAddress: creator,
          reason: `Límite de ${cfg.max_token_creations_per_day} tokens premiados por día alcanzado (anti-spam).`,
        });
      } else {
        creationsPerDay.set(dayKey, usedToday + 1);
        await push(
          "TOKEN_CREATED",
          token.address.toLowerCase(),
          cfg.events.TOKEN_CREATED.base_points,
          EVENT_REASON.TOKEN_CREATED,
          { createdAt: token.createdAt },
          token.createdAt,
        );
      }

      // 2. Unique buyers milestones (creator self-trading already removed)
      if (aggregate) {
        for (const hit of milestonesReached(cfg.buyer_milestones, cfg.milestone_points, aggregate.uniqueBuyers)) {
          await push(
            "UNIQUE_BUYER_MILESTONE",
            `${token.address.toLowerCase()}:${hit.threshold}`,
            hit.points,
            milestoneReason("UNIQUE_BUYER_MILESTONE", hit.threshold),
            { milestone: hit.threshold, uniqueBuyers: aggregate.uniqueBuyers },
            null,
          );
        }

        // 4. Organic volume milestones (self + wash volume removed)
        for (const hit of milestonesReached(cfg.volume_milestones, cfg.milestone_points, aggregate.organicVolume)) {
          await push(
            "ORGANIC_VOLUME_MILESTONE",
            `${token.address.toLowerCase()}:${hit.threshold}`,
            hit.points,
            milestoneReason("ORGANIC_VOLUME_MILESTONE", hit.threshold),
            {
              milestone: hit.threshold,
              organicVolume: Number(aggregate.organicVolume.toFixed(4)),
              excludedSelfVolume: Number(aggregate.selfVolume.toFixed(4)),
            },
            null,
          );
        }
      }

      // 3. Holders milestones (real on-chain holders only)
      for (const hit of milestonesReached(cfg.holder_milestones, cfg.milestone_points, token.holders)) {
        await push(
          "HOLDER_MILESTONE",
          `${token.address.toLowerCase()}:${hit.threshold}`,
          hit.points,
          milestoneReason("HOLDER_MILESTONE", hit.threshold),
          { milestone: hit.threshold, holders: token.holders },
          null,
        );
      }

      // 5. Trending / graduation achievements (one-time per token)
      const flags = achievementFlags(ctx);
      for (const [eventType, occurredAt] of Object.entries(flags) as [PointsEventType, string | null][]) {
        await push(
          eventType,
          token.address.toLowerCase(),
          cfg.events[eventType].base_points,
          EVENT_REASON[eventType],
          { bestTrendingRank: token.bestTrendingRank, bondingProgress: token.bondingProgress },
          occurredAt,
        );
      }

      // 6. Community milestone — only real holders + real unique buyers
      if (
        token.holders != null &&
        token.holders >= cfg.community_min_holders &&
        (aggregate?.uniqueBuyers ?? 0) >= cfg.community_min_buyers
      ) {
        await push(
          "COMMUNITY_MILESTONE",
          token.address.toLowerCase(),
          cfg.events.COMMUNITY_MILESTONE.base_points,
          EVENT_REASON.COMMUNITY_MILESTONE,
          { holders: token.holders, uniqueBuyers: aggregate?.uniqueBuyers ?? 0 },
          null,
        );
      }
    }

    // ------------------------------ idempotency -----------------------------
    const seen = new Set<string>();
    const unique = candidates.filter((c) => (seen.has(c.fingerprint) ? false : (seen.add(c.fingerprint), true)));
    const duplicatesInBatch = candidates.length - unique.length;

    let stored = new Set<string>();
    if (storage.ready) stored = await existingFingerprints(unique.map((c) => c.fingerprint));
    const fresh = unique.filter((c) => !stored.has(c.fingerprint));
    const duplicatesSkipped = duplicatesInBatch + (unique.length - fresh.length);

    // -------------------------------- caps ---------------------------------
    const todayTotals = storage.ready ? await todayPointsByTokenEvent(ACTIVE_CHAIN_ID) : new Map<string, number>();
    const running = new Map<string, number>();
    const eligible: PointsCandidate[] = [];
    for (const c of fresh) {
      const rule = cfg.events[c.eventType];
      const key = `${c.tokenAddress ?? "-"}|${c.eventType}`;
      const already = (todayTotals.get(key) ?? 0) + (running.get(key) ?? 0);
      if (rule.daily_cap > 0 && already + c.points > rule.daily_cap) {
        exclusions.push({
          eventType: c.eventType,
          tokenAddress: c.tokenAddress,
          creatorAddress: c.creatorAddress,
          reason: `Cap diario alcanzado (${rule.daily_cap} puntos/token/día).`,
        });
        continue;
      }
      running.set(key, (running.get(key) ?? 0) + c.points);
      eligible.push(c);
    }

    let awarded = 0;
    if (!dryRun && eligible.length) {
      const res = await appendLedger(eligible);
      if (res.error) {
        errors += 1;
        lastError = res.error;
      }
      awarded = eligible.slice(0, res.inserted).reduce((s, c) => s + c.points, 0);
      // 🏆 Fase 2C.1 — level history sync reuses this cron (no parallel job).
      try {
        const lh = await import("@/lib/levels/level-history.server");
        const sync = await lh.runLevelHistorySync("points-engine");
        if (sync.milestonesInserted) {
          notes.push(`${sync.milestonesInserted} nuevos milestones de nivel registrados.`);
        }
        if (sync.errors) notes.push(`Level history: ${sync.errors} errores (${sync.lastError ?? "?"}).`);
      } catch (e) {
        notes.push(`Level history sync no disponible: ${e instanceof Error ? e.message : "error"}.`);
      }
      // 🏅 Fase 2D — achievements engine reuses this same cron (no new job).
      try {
        const ac = await import("@/lib/achievements/achievement-engine.server");
        const run = await ac.runAchievementsEngine("points-engine");
        if (run.achievementsUnlocked) notes.push(`${run.achievementsUnlocked} achievements desbloqueados.`);
        if (run.skipped && run.skippedReason) notes.push(`Achievements: ${run.skippedReason}`);
      } catch (e) {
        notes.push(`Achievements engine no disponible: ${e instanceof Error ? e.message : "error"}.`);
      }
      if (res.inserted !== eligible.length) {
        notes.push(`${eligible.length - res.inserted} eventos ya existían en el ledger (idempotencia).`);
      }
    } else {
      awarded = eligible.reduce((s, c) => s + c.points, 0);
    }

    const finished = Date.now();
    const state: PointsEngineState = {
      ...base,
      finishedAt: new Date(finished).toISOString(),
      lastSuccessAt: dryRun ? base.lastSuccessAt : new Date(finished).toISOString(),
      creatorsScanned,
      tokensScanned,
      eventsScanned: candidates.length,
      eventsEligible: eligible.length,
      pointsAwarded: awarded,
      duplicatesSkipped,
      antiFarmingExcluded: exclusions.length,
      errors,
      lastError,
      durationMs: finished - startedAtMs,
      notes,
    };

    console.info(
      `[CREATOR_POINTS] run ${runId} (${trigger}${dryRun ? ", dry-run" : ""}) — creators ${creatorsScanned} · tokens ${tokensScanned} · events ${candidates.length} · eligible ${eligible.length} · points ${awarded} · duplicates ${duplicatesSkipped} · excluded ${exclusions.length} · errors ${errors} · ${finished - startedAtMs}ms`,
    );

    if (!dryRun) {
      const previous = await import("./points-config.server").then((m) => m.loadPointsState());
      await savePointsState({ ...state, lastSuccessAt: state.lastSuccessAt ?? previous.lastSuccessAt });
    }

    return { ok: errors === 0, dryRun, state, candidates: eligible, exclusions };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Creator Points Engine failure";
    console.error(`[CREATOR_POINTS] run failed: ${message}`);
    const finished = Date.now();
    const state: PointsEngineState = {
      ...base,
      finishedAt: new Date(finished).toISOString(),
      creatorsScanned,
      tokensScanned,
      errors: errors + 1,
      lastError: message,
      durationMs: finished - startedAtMs,
      notes,
    };
    if (!dryRun) await savePointsState(state);
    return { ok: false, dryRun, state, candidates: [], exclusions };
  } finally {
    if (!dryRun) await releasePointsLock(lock.token);
  }
}
