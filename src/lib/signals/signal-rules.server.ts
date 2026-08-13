// Detection rules. Every rule reads the REAL market-data layer / Trade events.
// A rule returns candidates only when the evidence exists; otherwise it returns
// a skip with an explicit reason — never an invented value.
import type { TokenMarketData } from "@/lib/launchpad/types";
import type { TradeEvent } from "@/lib/web3/curve-events";
import { computeAth } from "@/lib/web3/ath";
import { timeAgo } from "./signal-formatters";
import type { SignalCandidate, SignalConfig } from "./signal-types";

const n = (v: string | null | undefined) => (v == null ? null : Number(v));

function base(t: TokenMarketData) {
  return {
    symbol: t.symbol,
    name: t.name,
    marketCap: n(t.marketCap),
    liquidity: n(t.liquidity),
    volume24h: n(t.volume24h),
    holders: t.holders,
    bondingProgress: t.bondingProgress,
    bondingRemaining: n(t.bondingRemaining),
    priceChange24h: t.priceChange24h,
  };
}

export function newTokenCandidate(t: TokenMarketData): SignalCandidate {
  return {
    type: "NEW_TOKEN",
    tokenAddress: t.address,
    eventId: t.address.toLowerCase(),
    metric: n(t.marketCap),
    txHash: null,
    data: { ...base(t), createdAgo: t.createdAt ? timeAgo(t.createdAt) : "recently" },
  };
}

export function graduationCandidate(t: TokenMarketData): SignalCandidate | null {
  if (t.graduationStatus !== "graduated") return null;
  return {
    type: "GRADUATION",
    tokenAddress: t.address,
    eventId: `${t.address.toLowerCase()}:graduated`,
    metric: n(t.marketCap),
    txHash: null,
    data: base(t),
  };
}

export function kingCandidate(t: TokenMarketData): SignalCandidate {
  return {
    type: "KING_OF_THE_HILL",
    tokenAddress: t.address,
    eventId: t.address.toLowerCase(),
    metric: n(t.marketCap),
    txHash: null,
    data: base(t),
  };
}

/** Highest milestone crossed that has not been published yet. */
export function bondingCandidate(
  t: TokenMarketData,
  cfg: SignalConfig,
  highestNotified: number | null,
): SignalCandidate | null {
  const progress = t.bondingProgress;
  if (progress == null || t.graduationStatus === "graduated") return null;
  const milestones = [...cfg.bonding_milestones].sort((a, b) => a - b);
  const crossed = milestones.filter((m) => progress >= m);
  if (!crossed.length) return null;
  const top = crossed[crossed.length - 1];
  if (highestNotified != null && top <= highestNotified) return null;
  return {
    type: "BONDING_PROGRESS",
    tokenAddress: t.address,
    eventId: `${t.address.toLowerCase()}:milestone:${top}`,
    metric: top,
    txHash: null,
    data: { ...base(t), previousMilestone: highestNotified },
  };
}

export function athCandidate(
  t: TokenMarketData,
  events: TradeEvent[],
  cfg: SignalConfig,
  lastNotifiedAth: number | null,
): SignalCandidate | null {
  const ath = computeAth(events);
  if (!ath) return null;
  const price = Number(ath.priceWei) / 1e18;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (lastNotifiedAth != null) {
    const change = ((price - lastNotifiedAth) / lastNotifiedAth) * 100;
    if (change <= cfg.ath_min_change_pct) return null;
  }
  return {
    type: "NEW_ATH",
    tokenAddress: t.address,
    eventId: `${t.address.toLowerCase()}:ath:${ath.txHash}`,
    metric: price,
    txHash: ath.txHash,
    data: {
      ...base(t),
      athPrice: price,
      previousAth: lastNotifiedAth,
      athTime: new Date(ath.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC",
    },
  };
}

export type VolumeAnalysis =
  | { ok: true; windowVolume: number; baseline: number; increasePct: number; trades: number }
  | { ok: false; reason: "insufficient-history" | "baseline-unavailable" | "threshold-not-reached" };

/**
 * Compares the volume of the current window against the average of the previous
 * complete windows built from the token's real trade history. Without enough
 * history the answer is "no signal" — never a guessed baseline.
 */
export function analyzeVolume(events: TradeEvent[], cfg: SignalConfig, now = Date.now()): VolumeAnalysis {
  const windowSec = Math.max(1, cfg.volume_window_min) * 60;
  const nowSec = Math.floor(now / 1000);
  const need = Math.max(1, cfg.volume_min_baseline_windows);

  if (!events.length) return { ok: false, reason: "insufficient-history" };
  const oldest = Math.min(...events.map((e) => e.timestamp));
  if (nowSec - oldest < windowSec * (need + 1)) return { ok: false, reason: "insufficient-history" };

  const inWindow = events.filter((e) => e.timestamp > nowSec - windowSec);
  const windowVolume = inWindow.reduce((s, e) => s + Number(e.amountBnb) / 1e18, 0);

  const past: number[] = [];
  for (let i = 1; i <= need; i += 1) {
    const to = nowSec - windowSec * i;
    const from = to - windowSec;
    past.push(
      events
        .filter((e) => e.timestamp > from && e.timestamp <= to)
        .reduce((s, e) => s + Number(e.amountBnb) / 1e18, 0),
    );
  }
  const baseline = past.reduce((a, b) => a + b, 0) / past.length;
  if (!Number.isFinite(baseline) || baseline <= 0) return { ok: false, reason: "baseline-unavailable" };
  if (windowVolume < cfg.volume_min_bnb) return { ok: false, reason: "threshold-not-reached" };
  if (windowVolume < baseline * cfg.volume_multiplier) return { ok: false, reason: "threshold-not-reached" };

  return {
    ok: true,
    windowVolume,
    baseline,
    increasePct: ((windowVolume - baseline) / baseline) * 100,
    trades: inWindow.length,
  };
}

export function volumeCandidate(t: TokenMarketData, a: Extract<VolumeAnalysis, { ok: true }>, cfg: SignalConfig): SignalCandidate {
  const bucket = Math.floor(Date.now() / (cfg.volume_window_min * 60_000));
  return {
    type: "VOLUME_SPIKE",
    tokenAddress: t.address,
    eventId: `${t.address.toLowerCase()}:vol:${cfg.volume_window_min}:${bucket}`,
    metric: a.windowVolume,
    txHash: null,
    data: {
      ...base(t),
      windowVolume: a.windowVolume,
      baseline: a.baseline,
      increasePct: a.increasePct,
      windowMinutes: cfg.volume_window_min,
      trades: a.trades,
    },
  };
}

/** Whale trades inside the current window, above the configured threshold. */
export function whaleCandidates(t: TokenMarketData, events: TradeEvent[], cfg: SignalConfig, now = Date.now()): SignalCandidate[] {
  const nowSec = Math.floor(now / 1000);
  const windowSec = Math.max(1, cfg.volume_window_min) * 60;
  const out: SignalCandidate[] = [];
  for (const e of events) {
    if (e.timestamp <= nowSec - windowSec) continue;
    if (!e.txHash || !e.trader) continue;
    const amount = Number(e.amountBnb) / 1e18;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const threshold = e.isBuy ? cfg.whale_buy_bnb : cfg.whale_sell_bnb;
    if (amount < threshold) continue;
    out.push({
      type: e.isBuy ? "WHALE_BUY" : "WHALE_SELL",
      tokenAddress: t.address,
      eventId: `${e.txHash}:${e.key}`,
      metric: amount,
      txHash: e.txHash,
      data: {
        ...base(t),
        amountBnb: amount,
        wallet: e.trader,
        price: Number(e.price) / 1e18,
        marketCap: e.marketCap > 0n ? Number(e.marketCap) / 1e18 : n(t.marketCap),
        tradeTime: new Date(e.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC",
      },
    });
  }
  return out;
}
