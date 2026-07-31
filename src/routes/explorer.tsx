import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/labsbnb/AppShell";
import { fetchLaunchTokens, type LaunchToken } from "@/lib/token-list";
import { fetchTradeEvents, type TradeEvent } from "@/lib/web3/curve-events";
import { Search, TrendingUp, Coins, ArrowLeftRight, Users } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/explorer")({
  head: () => ({
    meta: [
      { title: "Explorer — LabsBNB Launchpad" },
      { name: "description", content: "On-chain explorer: latest tokens, trades and top volume on LabsBNB Launchpad." },
      { property: "og:title", content: "Explorer — LabsBNB Launchpad" },
      { property: "og:description", content: "Latest tokens, trades and volume leaders." },
    ],
  }),
  component: ExplorerPage,
});

function ExplorerPage() {
  const [q, setQ] = useState("");

  const latestTokens = useQuery({
    queryKey: ["ex-tokens"],
    refetchInterval: 15_000,
    queryFn: () => fetchLaunchTokens(50),
  });

  const latestTrades = useQuery({
    queryKey: ["ex-trades", latestTokens.data?.map((token) => token.curve).join(",")],
    enabled: !!latestTokens.data,
    refetchInterval: 15_000,
    queryFn: async () => {
      const tokens = latestTokens.data ?? [];
      const pages = await Promise.all(
        tokens
          .filter((token): token is LaunchToken & { curve: `0x${string}` } => token.curve !== null)
          .map(async (token) => {
            try {
              return { token, events: await fetchTradeEvents(token.curve) };
            } catch (error) {
              console.warn(`[explorer] trades unavailable for ${token.address ?? token.contract_address}`, error);
              return { token, events: [] as TradeEvent[] };
            }
          }),
      );
      return pages.flatMap(({ token, events }) => events.map((event) => ({ token, event }))).sort((a, b) => b.event.timestamp - a.event.timestamp).slice(0, 50);
    },
  });

  const topVolume = [...(latestTokens.data ?? [])]
    .filter((token) => BigInt(token.metrics?.volume24hWei ?? "0") > 0n)
    .sort((a, b) => Number(BigInt(b.metrics?.volume24hWei ?? "0") - BigInt(a.metrics?.volume24hWei ?? "0")))
    .slice(0, 10);

  const filtered = (latestTokens.data ?? []).filter((t) =>
    !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.ticker.toLowerCase().includes(q.toLowerCase()) || (t.contract_address ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
            <Search className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Explorer</h1>
            <p className="text-sm text-muted-foreground">Latest tokens, trades and volume leaders on-chain.</p>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-3 mb-8 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground ml-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, ticker or contract…"
            className="flex-1 bg-transparent outline-none text-sm py-2"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="glass rounded-2xl p-5 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Coins className="h-4 w-4 text-accent" />
              <h3 className="font-display font-semibold">Latest tokens</h3>
            </div>
            <ul className="divide-y divide-white/5">
              {filtered.map((tk) => (
                <li key={tk.id}>
                  <Link to="/token/$address" params={{ address: tk.contract_address ?? tk.id }} className="flex items-center justify-between py-3 hover:bg-white/5 rounded-lg px-2 -mx-2 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      {tk.logo_url ? <img src={tk.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <div className="h-9 w-9 rounded-lg brand-gradient grid place-items-center text-xs font-bold text-primary-foreground">{tk.ticker[0]}</div>}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{tk.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">${tk.ticker}</div>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{tk.status}</span>
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">No tokens found.</li>}
            </ul>
          </div>

          <div className="space-y-6">
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-success" />
                <h3 className="font-display font-semibold">Top 24h volume</h3>
              </div>
              <ol className="space-y-2 text-sm">
                {topVolume.map((token, i) => (
                  <li key={token.id} className="flex items-center justify-between">
                    <Link to="/token/$address" params={{ address: token.contract_address }} className="flex items-center gap-2 hover:text-accent">
                      <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                      {token.logo_url ? <img src={token.logo_url} className="h-5 w-5 rounded object-cover" alt="" /> : <span className="h-5 w-5 rounded brand-gradient" />}
                      <span className="truncate">{token.name}</span>
                    </Link>
                    <span className="font-mono text-xs">{(Number(token.metrics?.volume24hWei ?? "0") / 1e18).toFixed(3)} BNB</span>
                  </li>
                ))}
                {topVolume.length === 0 && <li className="py-6 text-center text-xs text-muted-foreground">No trades in 24h.</li>}
              </ol>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                <h3 className="font-display font-semibold">Live trades</h3>
              </div>
              <ul className="divide-y divide-white/5 text-xs">
                {(latestTrades.data ?? []).slice(0, 12).map(({ token, event }) => {
                  return (
                    <li key={`${token.id}-${event.key}`} className="py-2 flex items-center justify-between gap-2">
                      <span className={event.isBuy ? "text-success uppercase" : "text-destructive uppercase"}>{event.isBuy ? "buy" : "sell"}</span>
                      <span className="flex-1 truncate">{token.ticker}</span>
                      <span className="font-mono">{(Number(event.amountBnb) / 1e18).toFixed(3)} BNB</span>
                    </li>
                  );
                })}
                {(latestTrades.data ?? []).length === 0 && <li className="py-6 text-center text-muted-foreground">No trades yet.</li>}
              </ul>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-accent" />
                <h3 className="font-display font-semibold text-sm">Network</h3>
              </div>
              <NetworkStats tokens={latestTokens.data ?? []} trades={(latestTrades.data ?? []).map((row) => row.event)} />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function NetworkStats({ tokens, trades }: { tokens: LaunchToken[]; trades: TradeEvent[] }) {
  const wallets = new Set(trades.map((trade) => trade.trader.toLowerCase())).size;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat label="Tokens" value={tokens.length} />
      <Stat label="Trades" value={trades.length} />
      <Stat label="Wallets" value={wallets} />
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="font-display text-lg font-bold text-gradient">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
