// 🏆 Creator Achievements (Fase 2D) — pure, deterministic rules.
//
// No I/O: fingerprints, threshold reading, eligibility evaluation and evidence
// construction live here so everything is unit-testable and reproducible.
//
// HARD RULES:
//   • An achievement NEVER awards Creator Points.
//   • Missing / unverifiable evidence → NO AWARD (never invent a value).
//   • Manipulative activity (low organic score) → NO AWARD.
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_RARITIES,
  DEFAULT_ACHIEVEMENTS_CONFIG,
  DEFAULT_ACHIEVEMENT_DEFINITIONS,
  type AchievementCandidate,
  type AchievementDefinition,
  type AchievementEvidence,
  type AchievementProgress,
  type AchievementsConfig,
} from "./achievement-types";

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class AchievementError extends Error {}

/** Canonical identity: everything is stored and compared lowercase. */
export function normalizeAddress(address: string): string {
  const value = (address ?? "").trim();
  if (!ADDRESS_RE.test(value)) throw new AchievementError("Dirección inválida.");
  return value.toLowerCase();
}

/* ------------------------------- fingerprint ------------------------------ */

/** ACHIEVEMENT|chainId|creator|key[|token] — deterministic idempotency input. */
export function fingerprintInput(parts: {
  chainId: number;
  creatorAddress: string;
  achievementKey: string;
  sourceId?: string | null;
}): string {
  const base = ["ACHIEVEMENT", String(parts.chainId), parts.creatorAddress.toLowerCase(), parts.achievementKey];
  if (parts.sourceId) base.push(parts.sourceId.toLowerCase());
  return base.join("|");
}

export async function fingerprint(parts: Parameters<typeof fingerprintInput>[0]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput(parts)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* -------------------------------- context --------------------------------- */

/** Real, already-validated facts of one token of the creator. */
export type AchievementTokenFacts = {
  address: string;
  symbol: string;
  /** Launch timestamp (ISO) from the launchpad `tokens` table. null → unknown. */
  createdAt: string | null;
  /** Real holder count on-chain. null → not measurable right now. */
  holders: number | null;
  bondingProgress: number | null;
  graduated: boolean;
  graduatedAt: string | null;
  /** Best trending rank ever recorded in `trending_snapshots`. */
  bestTrendingRank: number | null;
  bestTrendingScore: number | null;
  /** Distinct Top-5 appearances (deduplicated per token/day). */
  top5Appearances: number;
  /** First snapshot timestamp where bonding progress crossed the threshold. */
  nearGraduationAt: string | null;
  /** 0..100 anti-farming score from the Trending Engine. */
  organicScore: number;
  whaleTrades: number;
  buyers: number;
  /** Creation transaction hash when the launchpad recorded it. */
  creationTx: string | null;
  creationBlock: number | null;
};

export type AchievementContext = {
  chainId: number;
  creatorAddress: string;
  tokens: AchievementTokenFacts[];
  /** Current level derived from `creator_points_ledger` (null → levels off). */
  creatorLevel: number | null;
  /** Levels already persisted in `creator_level_history`. */
  levelMilestones: number[];
  /** Achievement keys already unlocked (from the immutable ledger). */
  unlockedKeys: Set<string>;
};

/* -------------------------------- helpers --------------------------------- */

const num = (def: AchievementDefinition | null, key: string, fallback: number) => {
  const v = def?.ruleConfig?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

export function definitionFor(config: AchievementsConfig, key: string): AchievementDefinition | null {
  return config.definitions.find((d) => d.key === key) ?? null;
}

const hoursBetween = (fromIso: string, toIso: string): number | null => {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
};

/* ------------------------------- evaluation -------------------------------- */

export type AchievementEvaluation = {
  key: string;
  unlocked: boolean;
  /** Token / composite source of the unlock (part of the fingerprint). */
  sourceType: string;
  sourceId: string | null;
  evidence: AchievementEvidence | null;
  progress: AchievementProgress;
  /** Explains why it was not awarded (admin observability only). */
  reason: string | null;
};

type Evaluator = (ctx: AchievementContext, def: AchievementDefinition | null) => AchievementEvaluation;

const locked = (
  key: string,
  reason: string,
  progress: AchievementProgress = null,
  sourceType = "none",
): AchievementEvaluation => ({ key, unlocked: false, sourceType, sourceId: null, evidence: null, progress, reason });

const bestBy = <T,>(list: T[], score: (t: T) => number | null): T | null => {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of list) {
    const s = score(item);
    if (s == null) continue;
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
};

const firstLaunch: Evaluator = (ctx) => {
  // Ordered by real creation timestamp; tokens without a timestamp cannot prove
  // "first", so they are only used when nothing better exists.
  const dated = ctx.tokens.filter((t) => t.createdAt).sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!));
  const token = dated[0] ?? null;
  if (!token) return locked("first_launch", "Sin timestamp de creación verificable.");
  return {
    key: "first_launch",
    unlocked: true,
    sourceType: "token_creation",
    sourceId: token.address,
    evidence: {
      tokenAddress: token.address,
      symbol: token.symbol,
      transactionHash: token.creationTx,
      blockNumber: token.creationBlock,
      timestamp: token.createdAt,
      metric: "tokens_created",
      value: ctx.tokens.length,
    },
    progress: { current: Math.min(1, ctx.tokens.length), target: 1, label: "tokens lanzados" },
    reason: null,
  };
};

const holdersAchievement =
  (key: string, fallbackHolders: number, requireOrganic: boolean): Evaluator =>
  (ctx, def) => {
    const target = Math.max(1, Math.floor(num(def, "holders", fallbackHolders)));
    const minOrganic = requireOrganic ? num(def, "minOrganicScore", 55) : 0;
    const minBuyers = requireOrganic ? num(def, "minBuyers", 0) : 0;
    const measurable = ctx.tokens.filter((t) => t.holders != null);
    const best = bestBy(measurable, (t) => t.holders);
    const current = best?.holders ?? 0;
    const progress: AchievementProgress = measurable.length
      ? { current, target, label: "holders reales" }
      : null;
    if (!best) return locked(key, "Holders no medibles on-chain todavía.", null, "holders");
    if (current < target) return locked(key, `Holders ${current}/${target}.`, progress, "holders");
    if (requireOrganic && best.organicScore < minOrganic) {
      return locked(key, `Actividad no suficientemente orgánica (${best.organicScore}/${minOrganic}).`, progress, "holders");
    }
    if (requireOrganic && best.buyers < minBuyers) {
      return locked(key, `Compradores únicos ${best.buyers}/${minBuyers}.`, progress, "holders");
    }
    return {
      key,
      unlocked: true,
      sourceType: "holders",
      sourceId: best.address,
      evidence: {
        tokenAddress: best.address,
        symbol: best.symbol,
        metric: "holders",
        value: current,
        threshold: target,
        organicScore: best.organicScore,
        uniqueBuyers: best.buyers,
        timestamp: null,
      },
      progress,
      reason: null,
    };
  };

const trendingCreator: Evaluator = (ctx, def) => {
  const rankTarget = Math.max(1, Math.floor(num(def, "rank", 5)));
  const best = ctx.tokens
    .filter((t) => t.bestTrendingRank != null)
    .sort((a, b) => (a.bestTrendingRank ?? 99) - (b.bestTrendingRank ?? 99))[0];
  if (!best?.bestTrendingRank) return locked("trending_creator", "Sin apariciones registradas en Trending.", null, "trending_snapshot");
  if (best.bestTrendingRank > rankTarget) {
    return locked(
      "trending_creator",
      `Mejor rank #${best.bestTrendingRank} (requiere Top ${rankTarget}).`,
      { current: rankTarget, target: best.bestTrendingRank, label: "mejor rank" },
      "trending_snapshot",
    );
  }
  return {
    key: "trending_creator",
    unlocked: true,
    sourceType: "trending_snapshot",
    sourceId: best.address,
    evidence: {
      tokenAddress: best.address,
      symbol: best.symbol,
      metric: "trending_rank",
      value: best.bestTrendingRank,
      threshold: rankTarget,
      trendingScore: best.bestTrendingScore,
      timestamp: null,
    },
    progress: null,
    reason: null,
  };
};

const trendingMaster: Evaluator = (ctx, def) => {
  const target = Math.max(1, Math.floor(num(def, "appearances", 3)));
  const total = ctx.tokens.reduce((s, t) => s + Math.max(0, t.top5Appearances), 0);
  const progress: AchievementProgress = { current: total, target, label: "apariciones Top 5" };
  if (total < target) return locked("trending_master", `Apariciones Top 5 ${total}/${target}.`, progress, "trending_snapshot");
  const tokens = ctx.tokens.filter((t) => t.top5Appearances > 0).map((t) => t.address);
  return {
    key: "trending_master",
    unlocked: true,
    sourceType: "trending_snapshot",
    sourceId: null,
    evidence: {
      metric: "top5_appearances",
      value: total,
      threshold: target,
      tokens,
      timestamp: null,
    },
    progress,
    reason: null,
  };
};

const speedRunner: Evaluator = (ctx, def) => {
  const maxHours = Math.max(1, num(def, "hours", 24));
  const candidates = ctx.tokens.filter((t) => t.createdAt && t.nearGraduationAt);
  if (!candidates.length) {
    return locked("speed_runner", "Sin timestamps fiables de creación y Near Graduation.", null, "bonding_curve");
  }
  let bestToken: AchievementTokenFacts | null = null;
  let bestHours: number | null = null;
  for (const t of candidates) {
    const h = hoursBetween(t.createdAt!, t.nearGraduationAt!);
    if (h == null) continue;
    if (bestHours == null || h < bestHours) {
      bestHours = h;
      bestToken = t;
    }
  }
  if (!bestToken || bestHours == null) {
    return locked("speed_runner", "Timestamps inconsistentes: no se puede demostrar el tiempo.", null, "bonding_curve");
  }
  if (bestHours > maxHours) {
    return locked(
      "speed_runner",
      `Mejor tiempo ${bestHours.toFixed(1)}h (requiere ≤ ${maxHours}h).`,
      null,
      "bonding_curve",
    );
  }
  return {
    key: "speed_runner",
    unlocked: true,
    sourceType: "bonding_curve",
    sourceId: bestToken.address,
    evidence: {
      tokenAddress: bestToken.address,
      symbol: bestToken.symbol,
      metric: "hours_to_near_graduation",
      value: Number(bestHours.toFixed(2)),
      threshold: maxHours,
      createdAt: bestToken.createdAt,
      timestamp: bestToken.nearGraduationAt,
      bondingProgress: bestToken.bondingProgress,
    },
    progress: null,
    reason: null,
  };
};

const graduator: Evaluator = (ctx) => {
  const graduated = ctx.tokens.filter((t) => t.graduated);
  const first =
    graduated
      .filter((t) => t.graduatedAt)
      .sort((a, b) => Date.parse(a.graduatedAt!) - Date.parse(b.graduatedAt!))[0] ?? graduated[0];
  if (!first) {
    return locked("graduator", "Ningún token completó la Bonding Curve.", { current: 0, target: 1, label: "graduaciones" }, "graduation");
  }
  return {
    key: "graduator",
    unlocked: true,
    sourceType: "graduation",
    sourceId: first.address,
    evidence: {
      tokenAddress: first.address,
      symbol: first.symbol,
      metric: "graduation",
      value: 1,
      timestamp: first.graduatedAt,
      bondingProgress: first.bondingProgress,
    },
    progress: { current: 1, target: 1, label: "graduaciones" },
    reason: null,
  };
};

const multiGraduator: Evaluator = (ctx, def) => {
  const target = Math.max(2, Math.floor(num(def, "graduations", 3)));
  const unique = [...new Set(ctx.tokens.filter((t) => t.graduated).map((t) => t.address.toLowerCase()))];
  const progress: AchievementProgress = { current: unique.length, target, label: "tokens graduados" };
  if (unique.length < target) {
    return locked("multi_graduator", `Graduaciones ${unique.length}/${target}.`, progress, "graduation");
  }
  return {
    key: "multi_graduator",
    unlocked: true,
    sourceType: "graduation",
    sourceId: null,
    evidence: { metric: "graduations", value: unique.length, threshold: target, tokens: unique, timestamp: null },
    progress,
    reason: null,
  };
};

const whaleMagnet: Evaluator = (ctx, def) => {
  const minWhales = Math.max(1, Math.floor(num(def, "whaleTrades", 2)));
  const minOrganic = num(def, "minOrganicScore", 60);
  const minBuyers = Math.max(0, Math.floor(num(def, "minBuyers", 8)));
  const withWhales = ctx.tokens.filter((t) => t.whaleTrades > 0);
  if (!withWhales.length) return locked("whale_magnet", "Sin actividad de whales registrada.", null, "whale_activity");
  const best = bestBy(withWhales, (t) => t.organicScore);
  if (!best) return locked("whale_magnet", "Sin actividad de whales registrada.", null, "whale_activity");
  const progress: AchievementProgress = { current: best.whaleTrades, target: minWhales, label: "trades de whale" };
  if (best.whaleTrades < minWhales) {
    return locked("whale_magnet", `Trades de whale ${best.whaleTrades}/${minWhales}.`, progress, "whale_activity");
  }
  // Anti-farming: a single suspicious/circular whale never unlocks it.
  if (best.organicScore < minOrganic) {
    return locked(
      "whale_magnet",
      `Actividad clasificada como manipulativa (organic ${best.organicScore} < ${minOrganic}).`,
      progress,
      "whale_activity",
    );
  }
  if (best.buyers < minBuyers) {
    return locked(
      "whale_magnet",
      `Diversidad insuficiente de wallets (${best.buyers}/${minBuyers} compradores únicos).`,
      progress,
      "whale_activity",
    );
  }
  return {
    key: "whale_magnet",
    unlocked: true,
    sourceType: "whale_activity",
    sourceId: best.address,
    evidence: {
      tokenAddress: best.address,
      symbol: best.symbol,
      metric: "whale_trades",
      value: best.whaleTrades,
      threshold: minWhales,
      organicScore: best.organicScore,
      uniqueBuyers: best.buyers,
      timestamp: null,
    },
    progress,
    reason: null,
  };
};

const CREATOR_LEGEND_REQUIREMENTS = ["graduator", "multi_graduator", "trending_master"] as const;

const creatorLegend: Evaluator = (ctx, def) => {
  const requiredLevel = Math.max(1, Math.floor(num(def, "level", 7)));
  const level = ctx.creatorLevel ?? 0;
  const missing = CREATOR_LEGEND_REQUIREMENTS.filter((k) => !ctx.unlockedKeys.has(k));
  const met = CREATOR_LEGEND_REQUIREMENTS.length - missing.length + (level >= requiredLevel ? 1 : 0);
  const progress: AchievementProgress = {
    current: met,
    target: CREATOR_LEGEND_REQUIREMENTS.length + 1,
    label: "requisitos cumplidos",
  };
  if (level < requiredLevel) {
    return locked("creator_legend", `Nivel ${level}/${requiredLevel}.`, progress, "composite");
  }
  if (missing.length) {
    return locked("creator_legend", `Faltan achievements: ${missing.join(", ")}.`, progress, "composite");
  }
  return {
    key: "creator_legend",
    unlocked: true,
    sourceType: "composite",
    sourceId: null,
    evidence: {
      requirements: [...CREATOR_LEGEND_REQUIREMENTS],
      metric: "creator_level",
      value: level,
      threshold: requiredLevel,
      levelMilestones: ctx.levelMilestones.map(String),
      timestamp: null,
    },
    progress,
    reason: null,
  };
};

export const EVALUATORS: Record<string, Evaluator> = {
  first_launch: firstLaunch,
  community_starter: holdersAchievement("community_starter", 10, false),
  community_builder: holdersAchievement("community_builder", 50, true),
  trending_creator: trendingCreator,
  trending_master: trendingMaster,
  speed_runner: speedRunner,
  graduator,
  multi_graduator: multiGraduator,
  whale_magnet: whaleMagnet,
  creator_legend: creatorLegend,
};

/** Evaluation order matters: composites read the already-unlocked keys. */
export const EVALUATION_ORDER = [
  "first_launch",
  "community_starter",
  "community_builder",
  "trending_creator",
  "trending_master",
  "speed_runner",
  "graduator",
  "multi_graduator",
  "whale_magnet",
  "creator_legend",
] as const;

/** Evaluates ONE achievement against real facts. Pure. */
export function evaluateAchievementRule(
  key: string,
  ctx: AchievementContext,
  config: AchievementsConfig = DEFAULT_ACHIEVEMENTS_CONFIG,
): AchievementEvaluation {
  const evaluator = EVALUATORS[key];
  if (!evaluator) return locked(key, "Achievement desconocido.");
  const def = definitionFor(config, key);
  if (def && !def.enabled) return locked(key, "Achievement deshabilitado por el admin.");
  return evaluator(ctx, def);
}

/**
 * Evaluates the whole catalog and returns only the NEW unlocks as ledger
 * candidates (already-unlocked keys are never re-emitted; the DB UNIQUE
 * constraint is still the real idempotency guarantee).
 */
export async function evaluateCreatorContext(
  ctx: AchievementContext,
  config: AchievementsConfig = DEFAULT_ACHIEVEMENTS_CONFIG,
  opts: { backfill?: boolean } = {},
): Promise<{ candidates: AchievementCandidate[]; evaluations: AchievementEvaluation[] }> {
  const creatorAddress = normalizeAddress(ctx.creatorAddress);
  const unlockedKeys = new Set(ctx.unlockedKeys);
  const evaluations: AchievementEvaluation[] = [];
  const candidates: AchievementCandidate[] = [];
  if (!config.enabled) return { candidates, evaluations };

  for (const key of EVALUATION_ORDER) {
    const evaluation = evaluateAchievementRule(key, { ...ctx, creatorAddress, unlockedKeys }, config);
    evaluations.push(evaluation);
    if (!evaluation.unlocked || !evaluation.evidence) continue;
    // Historical unlocks are never re-awarded nor downgraded.
    if (unlockedKeys.has(key)) continue;
    unlockedKeys.add(key);
    candidates.push({
      chainId: ctx.chainId,
      creatorAddress,
      achievementKey: key,
      sourceType: evaluation.sourceType,
      sourceId: evaluation.sourceId,
      evidence: evaluation.evidence,
      fingerprint: await fingerprint({
        chainId: ctx.chainId,
        creatorAddress,
        achievementKey: key,
        sourceId: evaluation.sourceId,
      }),
      metadata: opts.backfill ? { backfill: true, reason: "initial_achievements_migration" } : { backfill: false },
    });
  }
  return { candidates, evaluations };
}

/* ------------------------------ configuration ----------------------------- */

const ICON_MAX = 4;

/**
 * Server-side validation of the admin-editable configuration.
 * Rejects unknown categories/rarities, empty text, negative thresholds and
 * duplicated keys. Definitions can be edited, never invented at runtime.
 */
export function validateAchievementsConfig(input: unknown): AchievementsConfig {
  const raw = (typeof input === "string" ? JSON.parse(input) : input) as Partial<AchievementsConfig> | null;
  if (!raw || typeof raw !== "object") throw new AchievementError("Configuración inválida.");
  const enabled = raw.enabled !== false;
  const list = Array.isArray(raw.definitions) ? raw.definitions : [];
  if (!list.length) throw new AchievementError("Debe existir al menos un achievement.");

  const seen = new Set<string>();
  const definitions: AchievementDefinition[] = list.map((d, i) => {
    const key = String(d?.key ?? "").trim();
    if (!/^[a-z0-9_]{3,40}$/.test(key)) throw new AchievementError(`Key inválida en la posición ${i + 1}.`);
    if (!EVALUATORS[key]) throw new AchievementError(`No existe evaluador para "${key}".`);
    if (seen.has(key)) throw new AchievementError(`Key duplicada: ${key}.`);
    seen.add(key);
    const name = String(d?.name ?? "").trim();
    const description = String(d?.description ?? "").trim();
    const icon = String(d?.icon ?? "").trim();
    if (name.length < 2 || name.length > 60) throw new AchievementError(`Nombre inválido en "${key}".`);
    if (description.length < 5 || description.length > 300) throw new AchievementError(`Descripción inválida en "${key}".`);
    if (!icon || [...icon].length > ICON_MAX) throw new AchievementError(`Icono inválido en "${key}".`);
    const category = String(d?.category ?? "");
    const rarity = String(d?.rarity ?? "");
    if (!(ACHIEVEMENT_CATEGORIES as readonly string[]).includes(category)) {
      throw new AchievementError(`Categoría inválida en "${key}".`);
    }
    if (!(ACHIEVEMENT_RARITIES as readonly string[]).includes(rarity)) {
      throw new AchievementError(`Rareza inválida en "${key}".`);
    }
    const ruleConfig: Record<string, number> = {};
    for (const [k, v] of Object.entries(d?.ruleConfig ?? {})) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new AchievementError(`Umbral inválido "${k}" en "${key}".`);
      ruleConfig[k] = n;
    }
    return {
      key,
      name,
      description,
      icon,
      category: category as AchievementDefinition["category"],
      rarity: rarity as AchievementDefinition["rarity"],
      enabled: d?.enabled !== false,
      displayOrder: Number.isFinite(Number(d?.displayOrder)) ? Number(d?.displayOrder) : (i + 1) * 10,
      ruleConfig,
    };
  });

  // Keys that exist in code but not in the stored config keep their defaults.
  for (const fallback of DEFAULT_ACHIEVEMENT_DEFINITIONS) {
    if (!seen.has(fallback.key)) definitions.push({ ...fallback });
  }
  definitions.sort((a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key));
  return { enabled, definitions };
}
