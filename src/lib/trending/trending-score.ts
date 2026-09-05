// LabsBNB Trending Engine — deterministic scoring (pure functions).
//
// This module NEVER touches the network or the database: it takes decoded
// on-chain `Trade(...)` events plus live curve values and returns the score.
// That makes every formula unit-testable and impossible to influence from the
// browser (the frontend only renders what the server computed).

import type { TradeEvent } from "@/lib/web3/curve-events";
import {
  WINDOW_SECONDS,
  TREND_WINDOWS,
  type TrendingBadge,
  type TrendingConfig,
  type TrendingMetrics,
  type TrendingScoreParts,
  type TrendingWeights,
  type WindowId,
  type WindowStats,
} from "./trending-types";

const bnb = (v: bigint) => Number(v) / 1e18;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Saturating normaliser: 0 → 0, k → 0.5, ∞ → 1. Keeps whales from maxing it. */
export function sat(value: number, k: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + k);
}

export const EMPTY_WINDOW: WindowStats = {
  volume: 0,
  trades: 0,
  buys: 0,
  sells: 0,
  buyers: 0,
  sellers: 0,
  traders: 0,
  topTraderShare: 0,
  roundTripShare: 0,
  whaleTrades: 0,
  whaleVolume: 0,
};

/** Aggregates the real trade stream inside a time window ending at `now`. */
export function windowStats(
  events: TradeEvent[],
  seconds: number,
  now: number,
  whaleBnb = 0.5,
): WindowStats {
  const cutoff = now - seconds;
  const inWindow = events.filter((e) => e.timestamp > cutoff && e.timestamp <= now);
  if (!inWindow.length) return { ...EMPTY_WINDOW };

  const perWallet = new Map<string, { volume: number; buys: number; sells: number }>();
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  let volume = 0;
  let buys = 0;
  let sells = 0;
  let whaleTrades = 0;
  let whaleVolume = 0;

  for (const e of inWindow) {
    const amount = bnb(e.amountBnb);
    const wallet = e.trader.toLowerCase();
    volume += amount;
    if (e.isBuy) { buys += 1; buyers.add(wallet); } else { sells += 1; sellers.add(wallet); }
    if (amount >= whaleBnb) { whaleTrades += 1; whaleVolume += amount; }
    const cur = perWallet.get(wallet) ?? { volume: 0, buys: 0, sells: 0 };
    cur.volume += amount;
    if (e.isBuy) cur.buys += 1; else cur.sells += 1;
    perWallet.set(wallet, cur);
  }

  let top = 0;
  let roundTrip = 0;
  for (const w of perWallet.values()) {
    if (w.volume > top) top = w.volume;
    if (w.buys > 0 && w.sells > 0) roundTrip += w.volume;
  }

  return {
    volume,
    trades: inWindow.length,
    buys,
    sells,
    buyers: buyers.size,
    sellers: sellers.size,
    traders: perWallet.size,
    topTraderShare: volume > 0 ? clamp01(top / volume) : 0,
    roundTripShare: volume > 0 ? clamp01(roundTrip / volume) : 0,
    whaleTrades,
    whaleVolume,
  };
}

/**
 * Organic Activity Score (0..100) — anti-manipulation / basic sybil damping.
 *
 *   40% wallet diversity (unique traders in 1h)
 *   30% volume dispersion (1 - share of the single largest wallet)
 *   30% absence of circular trading (1 - buy&sell round-trip volume share)
 *
 * A single giant transaction from one wallet lands near 0.4·? and therefore
 * cannot, by itself, push a token to the top of the ranking.
 */
export function organicActivityScore(hour: WindowStats): number {
  if (!hour.trades) return 0;
  const diversity = sat(hour.traders - 1, 3); // 1 wallet → 0, 4 wallets → 0.5
  const dispersion = 1 - hour.topTraderShare;
  const circular = 1 - hour.roundTripShare;
  return Math.round(100 * clamp01(0.4 * diversity + 0.3 * dispersion + 0.3 * circular));
}

/**
 * ⚡ Trending Velocity — acceleration of the trade *rate*, in %.
 *
 *   rateRecent = volume(15m) / 15
 *   ratePrior  = (volume(1h) - volume(15m)) / 45
 *   velocity   = (rateRecent / ratePrior - 1) * 100
 *
 * `null` when there is no prior activity to compare against (no invented %).
 */
export function computeVelocity(w15: WindowStats, w1h: WindowStats): number | null {
  const priorVolume = Math.max(0, w1h.volume - w15.volume);
  if (priorVolume <= 0) return null;
  const rateRecent = w15.volume / 15;
  const ratePrior = priorVolume / 45;
  if (ratePrior <= 0) return null;
  const pct = (rateRecent / ratePrior - 1) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

export type MetricsInput = {
  events: TradeEvent[];
  now: number; // unix seconds
  holders: number | null;
  previousHolders?: number | null;
  bondingProgress: number | null; // 0..100
  whaleBnb?: number;
};

/** Builds every temporal window + derived metric from the real event stream. */
export function computeMetrics(input: MetricsInput): TrendingMetrics {
  const whaleBnb = input.whaleBnb ?? 0.5;
  const windows = {} as Record<WindowId, WindowStats>;
  for (const id of TREND_WINDOWS) {
    windows[id] = windowStats(input.events, WINDOW_SECONDS[id], input.now, whaleBnb);
  }
  const lastTradeAt = input.events.length
    ? input.events.reduce((max, e) => (e.timestamp > max ? e.timestamp : max), 0)
    : null;

  return {
    windows,
    velocityPct: computeVelocity(windows["15m"], windows["1h"]),
    holders: input.holders,
    holdersGrowth:
      input.holders != null && input.previousHolders != null
        ? input.holders - input.previousHolders
        : null,
    bondingProgress: input.bondingProgress,
    lastTradeAt: lastTradeAt || null,
    organicScore: organicActivityScore(windows["1h"]),
  };
}

/* ------------------------------ score components --------------------------- */

function momentumComponent(m: TrendingMetrics): number {
  const w5 = m.windows["5m"];
  const w15 = m.windows["15m"];
  const w1h = m.windows["1h"];
  const recent = 0.35 * sat(w5.volume, 0.25) + 0.35 * sat(w15.volume, 0.5) + 0.15 * sat(w1h.volume, 2);
  const accel = m.velocityPct == null ? 0 : clamp01(m.velocityPct / 300);
  return clamp01(recent + 0.15 * accel);
}

function buyersComponent(m: TrendingMetrics): number {
  const w15 = m.windows["15m"];
  const w1h = m.windows["1h"];
  const unique = sat(w15.buyers, 3);
  const growth = w1h.buyers > 0 ? clamp01((w15.buyers * 4) / w1h.buyers / 4) : 0;
  const ratio =
    w15.buys + w15.sells > 0 ? w15.buys / (w15.buys + w15.sells) : w1h.buys + w1h.sells > 0 ? w1h.buys / (w1h.buys + w1h.sells) : 0;
  return clamp01(0.5 * unique + 0.2 * growth + 0.3 * ratio);
}

/** `null` when the chain does not expose a holder count for this token. */
function holdersComponent(m: TrendingMetrics): number | null {
  if (m.holders == null) return null;
  const base = sat(m.holders, 50);
  const growth = m.holdersGrowth == null ? null : clamp01(m.holdersGrowth / 10);
  return growth == null ? clamp01(base) : clamp01(0.6 * base + 0.4 * growth);
}

function bondingComponent(m: TrendingMetrics): number | null {
  if (m.bondingProgress == null) return null;
  return clamp01(m.bondingProgress / 100);
}

function whalesComponent(m: TrendingMetrics): number {
  const w1h = m.windows["1h"];
  if (!w1h.trades) return 0;
  const count = sat(w1h.whaleTrades, 2);
  const share = w1h.volume > 0 ? clamp01(w1h.whaleVolume / w1h.volume) : 0;
  return clamp01(0.7 * count + 0.3 * share);
}

function activityComponent(m: TrendingMetrics, now: number): number {
  const w15 = m.windows["15m"];
  const w1h = m.windows["1h"];
  const count = sat(w15.trades, 5);
  const frequency = sat(w1h.trades, 15);
  const minutesIdle = m.lastTradeAt ? Math.max(0, (now - m.lastTradeAt) / 60) : null;
  const recency = minutesIdle == null ? 0 : clamp01(1 / (1 + minutesIdle / 30));
  return clamp01(0.45 * count + 0.25 * frequency + 0.3 * recency);
}

export type ScoreResult = {
  score: number; // 0..100
  parts: TrendingScoreParts;
  organicFactor: number; // 0.4..1
};

/**
 * 🔥 Trending Score (0..100).
 *
 *   raw   = Σ(weightᵢ · componentᵢ) / Σ(weightᵢ)     ← unavailable components
 *                                                      are dropped and the
 *                                                      remaining weights are
 *                                                      renormalised (no
 *                                                      invented values)
 *   score = round(100 · raw · organicFactor)
 *   organicFactor = 0.4 + 0.6 · (organicScore / 100)
 */
export function computeTrendingScore(
  m: TrendingMetrics,
  weights: TrendingWeights,
  now: number,
): ScoreResult {
  const parts: TrendingScoreParts = {
    momentum: momentumComponent(m),
    buyers: buyersComponent(m),
    holders: holdersComponent(m),
    bonding: bondingComponent(m),
    whales: whalesComponent(m),
    activity: activityComponent(m, now),
  };

  let weighted = 0;
  let total = 0;
  (Object.keys(parts) as (keyof TrendingScoreParts)[]).forEach((key) => {
    const value = parts[key];
    const weight = Math.max(0, weights[key] ?? 0);
    if (value == null || weight <= 0) return;
    weighted += weight * value;
    total += weight;
  });

  const raw = total > 0 ? weighted / total : 0;
  const organicFactor = 0.4 + 0.6 * clamp01(m.organicScore / 100);
  const score = Math.round(Math.min(100, Math.max(0, raw * organicFactor * 100)));
  return { score, parts, organicFactor };
}

/* ---------------------------------- badges --------------------------------- */

export function computeBadges(
  m: TrendingMetrics,
  score: number,
  cfg: Pick<TrendingConfig, "velocity_threshold" | "near_graduation_pct">,
): TrendingBadge[] {
  const out: TrendingBadge[] = [];
  const w15 = m.windows["15m"];
  const w1h = m.windows["1h"];

  if (score >= 70 && w1h.trades > 0) out.push("trending");
  if (m.velocityPct != null && m.velocityPct >= cfg.velocity_threshold) out.push("rising_fast");
  if (m.bondingProgress != null && m.bondingProgress >= 90) out.push("graduation_soon");
  else if (m.bondingProgress != null && m.bondingProgress >= cfg.near_graduation_pct) out.push("near_graduation");
  if (w1h.whaleTrades > 0) out.push("whale_activity");
  const priorVolume = Math.max(0, w1h.volume - w15.volume);
  if (priorVolume > 0 && w15.volume / 15 >= 2 * (priorVolume / 45) && w15.trades >= 2) out.push("volume_spike");
  return out;
}

/**
 * "Why is this token trending?" — a factual summary of the real numbers.
 * No predictions, no investment language.
 */
export function explainTrending(m: TrendingMetrics): string {
  const w15 = m.windows["15m"];
  const w1h = m.windows["1h"];
  const bits: string[] = [];

  if (w15.trades > 0) {
    bits.push(
      `${w15.trades} trade${w15.trades === 1 ? "" : "s"} in the last 15 minutes (${w15.volume.toFixed(4)} BNB)`,
    );
  } else if (w1h.trades > 0) {
    bits.push(`${w1h.trades} trade${w1h.trades === 1 ? "" : "s"} in the last hour (${w1h.volume.toFixed(4)} BNB)`);
  }
  if (m.velocityPct != null) {
    bits.push(
      m.velocityPct >= 0
        ? `trading rate accelerated ${m.velocityPct.toFixed(0)}% versus the previous 45 minutes`
        : `trading rate slowed ${Math.abs(m.velocityPct).toFixed(0)}% versus the previous 45 minutes`,
    );
  }
  if (w15.buyers > 0) bits.push(`${w15.buyers} unique buyer${w15.buyers === 1 ? "" : "s"}`);
  if (w1h.whaleTrades > 0) bits.push(`${w1h.whaleTrades} large trade${w1h.whaleTrades === 1 ? "" : "s"} detected`);
  if (m.bondingProgress != null) bits.push(`bonding curve at ${m.bondingProgress.toFixed(1)}%`);
  if (m.holdersGrowth != null && m.holdersGrowth > 0) bits.push(`${m.holdersGrowth} new holders since the previous snapshot`);

  if (!bits.length) return "No on-chain trading activity recorded in the tracked time windows.";
  return `${bits.join(", ")}.`;
}
