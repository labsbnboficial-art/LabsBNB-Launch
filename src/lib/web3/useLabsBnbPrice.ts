import { useQuery } from "@tanstack/react-query";

/**
 * Fetches BNB price from CoinGecko public API (no key required).
 * Used as the source of truth for market cap / volume placeholders in Phase 1
 * until the real LabsBNB token address is wired up and the indexer publishes
 * on-chain metrics.
 */
export function useBnbPrice() {
  return useQuery({
    queryKey: ["bnb-price"],
    queryFn: async () => {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true",
      );
      if (!r.ok) throw new Error("price_fetch_failed");
      const j = (await r.json()) as {
        binancecoin: { usd: number; usd_24h_vol: number; usd_24h_change: number };
      };
      return {
        usd: j.binancecoin.usd,
        volume24h: j.binancecoin.usd_24h_vol,
        change24h: j.binancecoin.usd_24h_change,
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
