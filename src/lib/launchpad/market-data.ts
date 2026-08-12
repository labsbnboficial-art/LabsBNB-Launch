// Normalization layer: raw on-chain reads → `TokenMarketData`.
//
// Sources (single source of truth per metric):
//   price / marketCap / liquidity / volume24h / holders / progress
//        → BondingCurve views via `fetchLivePrice` (PancakeSwap pair after migration)
//   name / symbol / creator / token list
//        → LabsBNBFactory via `fetchFactoryTokens`
//   ATH / buys / sells / trade count / candles
//        → decoded `Trade(...)` logs via `curve-events`
//
// Isomorphic: viem only, so the AI Copilot server route reuses the exact same
// functions the browser uses.
import { fetchFactoryTokens, fetchOnChainToken } from "@/lib/web3/onchain-token";
import { fetchLivePrice } from "@/lib/web3/live-price";
import { fetchTradeEvents, type TradeEvent } from "@/lib/web3/curve-events";
import { computeAth, distanceFromAth } from "@/lib/web3/ath";
import type { TokenMarketData } from "./types";

const DAY = 86_400;

function fromWei(v: bigint | string | null | undefined): string | null {
  if (v == null) return null;
  const b = typeof v === "bigint" ? v : BigInt(v);
  return (Number(b) / 1e18).toString();
}

/** 24h buy/sell breakdown straight from the decoded Trade log stream. */
export function tradeBreakdown(events: TradeEvent[]) {
  const cutoff = Math.floor(Date.now() / 1000) - DAY;
  const recent = events.filter((e) => e.timestamp >= cutoff);
  return {
    transactions24h: recent.length,
    buys24h: recent.filter((e) => e.isBuy).length,
    sells24h: recent.filter((e) => !e.isBuy).length,
  };
}

export type MarketDataOptions = {
  /** Scan Trade logs (needed for ATH + buy/sell split). Costly; off by default. */
  withHistory?: boolean;
  events?: TradeEvent[];
};

/** Full normalized snapshot of one token. */
export async function getTokenMarketData(
  address: string,
  opts: MarketDataOptions = {},
): Promise<TokenMarketData | null> {
  const token = await fetchOnChainToken(address);
  if (!token) return null;

  const live = token.curve ? await fetchLivePrice(token.curve, token.address) : null;

  let events: TradeEvent[] = opts.events ?? [];
  if (!events.length && opts.withHistory && token.curve) {
    try {
      events = await fetchTradeEvents(token.curve);
    } catch {
      events = [];
    }
  }
  const hasHistory = events.length > 0;
  const ath = hasHistory ? computeAth(events) : null;
  const breakdown = hasHistory ? tradeBreakdown(events) : null;

  const progress = live ? Math.min(100, live.progressBps / 100) : null;
  const target = live ? Number(live.targetBnbWei) / 1e18 : null;
  const raised = live ? Number(live.liquidityWei) / 1e18 : null;

  return {
    address: token.address,
    curve: token.curve,
    name: token.name,
    symbol: token.ticker,
    image: token.metadataURI,
    creator: token.creator,

    price: live ? fromWei(live.priceWei) : null,
    marketCap: live ? fromWei(live.marketCapWei) : null,
    liquidity: live ? fromWei(live.liquidityWei) : null,
    volume24h: live ? fromWei(live.volume24hWei) : null,

    holders: live ? live.holders : null,
    priceChange24h: live ? live.priceChangeBps / 100 : null,

    athPrice: ath ? fromWei(ath.priceWei) : null,
    athDate: ath ? new Date(ath.timestamp * 1000).toISOString() : null,
    athMarketCap: ath && ath.marketCapWei > 0n ? fromWei(ath.marketCapWei) : null,
    distanceFromAth: live && ath ? distanceFromAth(live.priceWei, ath.priceWei) : null,

    bondingProgress: progress,
    bondingRemaining:
      target != null && raised != null ? String(Math.max(0, target - raised)) : null,
    graduationStatus: live?.migrated ? "graduated" : "bonding",

    transactions24h: breakdown?.transactions24h ?? null,
    buys24h: breakdown?.buys24h ?? null,
    sells24h: breakdown?.sells24h ?? null,

    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Normalized list built from the Factory (never from the database alone). */
export async function listMarketTokens(limit = 24): Promise<TokenMarketData[]> {
  const tokens = await fetchFactoryTokens(limit);
  return tokens.map((t) => {
    const m = t.metrics;
    const target = m ? Number(m.targetBnbWei) / 1e18 : null;
    const raised = m ? Number(m.liquidityWei) / 1e18 : null;
    return {
      address: t.address,
      curve: t.curve,
      name: t.name,
      symbol: t.ticker,
      image: t.metadataURI,
      creator: t.creator,
      price: m ? fromWei(m.priceWei) : null,
      marketCap: m ? fromWei(m.marketCapWei) : null,
      liquidity: m ? fromWei(m.liquidityWei) : null,
      volume24h: m ? fromWei(m.volume24hWei) : null,
      holders: m ? m.holders : null,
      priceChange24h: m ? m.priceChangeBps / 100 : null,
      athPrice: null,
      athDate: null,
      athMarketCap: null,
      distanceFromAth: null,
      bondingProgress: m ? Math.min(100, m.progressBps / 100) : null,
      bondingRemaining:
        target != null && raised != null ? String(Math.max(0, target - raised)) : null,
      graduationStatus: m && m.progressBps >= 10_000 ? "graduated" : "bonding",
      transactions24h: null,
      buys24h: null,
      sells24h: null,
      createdAt: null,
      updatedAt: new Date().toISOString(),
    } satisfies TokenMarketData;
  });
}

const num = (v: string | null) => (v == null ? -1 : Number(v));

export const selectors = {
  topVolume: (t: TokenMarketData[]) => [...t].sort((a, b) => num(b.volume24h) - num(a.volume24h)),
  topMarketCap: (t: TokenMarketData[]) => [...t].sort((a, b) => num(b.marketCap) - num(a.marketCap)),
  topGainers: (t: TokenMarketData[]) =>
    [...t].sort((a, b) => (b.priceChange24h ?? -Infinity) - (a.priceChange24h ?? -Infinity)),
  topHolders: (t: TokenMarketData[]) => [...t].sort((a, b) => (b.holders ?? -1) - (a.holders ?? -1)),
  graduating: (t: TokenMarketData[]) =>
    t
      .filter((x) => x.graduationStatus === "bonding" && (x.bondingProgress ?? 0) > 0)
      .sort((a, b) => (b.bondingProgress ?? 0) - (a.bondingProgress ?? 0)),
  /** Same criterion already used by the King of the Hill component. */
  king: (t: TokenMarketData[]) => {
    const eligible = t.filter(
      (x) => x.bondingProgress != null && x.bondingProgress > 0 && x.bondingProgress < 100,
    );
    const pool = eligible.length ? eligible : t.filter((x) => num(x.marketCap) > 0);
    if (!pool.length) return null;
    return [...pool].sort((a, b) => {
      const p = (b.bondingProgress ?? 0) - (a.bondingProgress ?? 0);
      if (p !== 0) return p;
      const v = num(b.volume24h) - num(a.volume24h);
      if (v !== 0) return v;
      return num(b.marketCap) - num(a.marketCap);
    })[0];
  },
};
