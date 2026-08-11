// All-time-high computed from the token's REAL trade history.
//
// The only source is the Trade(...) event stream decoded in curve-events.ts:
// every event carries the executed `price` and the `marketCap` reported by the
// bonding curve at that block, so the ATH (and the market cap at the ATH) are
// exact on-chain values — never the current price, never a hardcoded number.
import type { TradeEvent } from "./curve-events";

export type Ath = {
  /** Highest executed price, 18-decimals fixed point. */
  priceWei: bigint;
  /** Market cap reported by the curve on the ATH trade (0n when unknown). */
  marketCapWei: bigint;
  /** Unix seconds of the ATH trade. */
  timestamp: number;
  txHash: string;
};

/** Returns the all-time high of the loaded history, or null when empty. */
export function computeAth(events: TradeEvent[]): Ath | null {
  let best: TradeEvent | null = null;
  for (const e of events) {
    if (e.price <= 0n) continue;
    if (!best || e.price > best.price) best = e;
  }
  if (!best) return null;
  return {
    priceWei: best.price,
    marketCapWei: best.marketCap,
    timestamp: best.timestamp,
    txHash: best.txHash,
  };
}

/**
 * Percentage distance between the current price and the ATH.
 * Negative means "below the ATH". Returns null when either side is unknown.
 */
export function distanceFromAth(current: bigint | null | undefined, ath: bigint | null | undefined): number | null {
  if (!current || !ath || ath <= 0n) return null;
  return (Number(current - ath) / Number(ath)) * 100;
}

export function formatAthDate(timestamp?: number | null): string {
  if (!timestamp) return "N/A";
  return new Date(timestamp * 1000).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
