// Realtime layer: on-chain Trade events → local cache invalidation → UI update.
//
// A single viem log watcher per curve (no duplicated subscriptions) drives the
// chart, recent trades and the market metrics. Polling is used only as the
// recovery mechanism of the watcher itself.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readClient } from "@/lib/web3/onchain-token";
import { TRADE_EVENT, invalidateTradeCache } from "@/lib/web3/curve-events";
import { CURVE_ABI } from "@/lib/web3/abis";
import type { Abi } from "viem";

export const qk = {
  tokens: ["launchpad", "tokens"] as const,
  market: (address?: string | null) => ["launchpad", "market", address ?? null] as const,
  trades: (curve?: string | null) => ["launchpad", "trades", curve ?? null] as const,
  live: (curve?: string | null) => ["launchpad", "live", curve ?? null] as const,
};

/**
 * Watches `Trade(...)` on one bonding curve. On every new trade the cached
 * block ranges are dropped and the dependent queries are revalidated, so
 * price, market cap, volume, candles and the trades table move together.
 */
export function useCurveRealtime(curve?: `0x${string}` | null, onTrade?: () => void) {
  const qc = useQueryClient();
  const cb = useRef(onTrade);
  cb.current = onTrade;

  useEffect(() => {
    if (!curve) return;
    let stopped = false;
    let unwatch: (() => void) | undefined;
    try {
      unwatch = readClient().watchContractEvent({
        address: curve,
        abi: CURVE_ABI as Abi,
        eventName: TRADE_EVENT.name,
        pollingInterval: 6_000,
        onLogs: () => {
          if (stopped) return;
          invalidateTradeCache(curve);
          qc.invalidateQueries({ queryKey: qk.trades(curve) });
          qc.invalidateQueries({ queryKey: qk.live(curve) });
          qc.invalidateQueries({ queryKey: qk.tokens });
          cb.current?.();
        },
        onError: () => {
          /* transport already falls back across RPCs */
        },
      });
    } catch {
      /* watcher unsupported on the active transport — queries keep polling */
    }
    return () => {
      stopped = true;
      unwatch?.();
    };
  }, [curve, qc]);
}
