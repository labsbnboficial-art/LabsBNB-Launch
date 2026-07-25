import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
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
    queryFn: async () => {
      const { data } = await supabase.from("tokens").select("id,name,ticker,logo_url,contract_address,status,created_at").order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const latestTrades = useQuery({
    queryKey: ["ex-trades"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase.from("trades").select("id,side,amount_bnb,amount_token,wallet_address,tx_hash,created_at,token_id,tokens(name,ticker,contract_address)").order("created_at", { ascending: false }).limit(30);
      return data ?? [];
    },
  });

  const topVolume = useQuery({
    queryKey: ["ex-top-vol"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await supabase.from("trades").select("token_id,amount_bnb,tokens(id,name,ticker,contract_address,logo_url)").gte("created_at", since);
      const agg = new Map<string, { vol: number; tk: { id: string; name: string; ticker: string; contract_address: string | null; logo_url: string | null } | null }>();
      (data ?? []).forEach((t) => {
        const cur = agg.get(t.token_id) ?? { vol: 0, tk: (t.tokens as never) ?? null };
        cur.vol += Number(t.amount_bnb) / 1e18;
        agg.set(t.token_id, cur);
      });
      return [...agg.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.vol - a.vol).slice(0, 10);
    },
  });

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
                {(topVolume.data ?? []).map((row, i) => row.tk && (
                  <li key={row.id} className="flex items-center justify-between">
                    <Link to="/token/$address" params={{ address: row.tk.contract_address ?? row.tk.id }} className="flex items-center gap-2 hover:text-accent">
                      <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                      {row.tk.logo_url ? <img src={row.tk.logo_url} className="h-5 w-5 rounded object-cover" alt="" /> : <span className="h-5 w-5 rounded brand-gradient" />}
                      <span className="truncate">{row.tk.name}</span>
                    </Link>
                    <span className="font-mono text-xs">{row.vol.toFixed(3)} BNB</span>
                  </li>
                ))}
                {(topVolume.data ?? []).length === 0 && <li className="py-6 text-center text-xs text-muted-foreground">No trades in 24h.</li>}
              </ol>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                <h3 className="font-display font-semibold">Live trades</h3>
              </div>
              <ul className="divide-y divide-white/5 text-xs">
                {(latestTrades.data ?? []).slice(0, 12).map((tr) => {
                  const tk = tr.tokens as unknown as { name: string; ticker: string; contract_address: string | null } | null;
                  return (
                    <li key={tr.id} className="py-2 flex items-center justify-between gap-2">
                      <span className={tr.side === "buy" ? "text-success uppercase" : "text-destructive uppercase"}>{tr.side}</span>
                      <span className="flex-1 truncate">{tk?.ticker ?? "—"}</span>
                      <span className="font-mono">{(Number(tr.amount_bnb) / 1e18).toFixed(3)} BNB</span>
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
              <NetworkStats />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function NetworkStats() {
  const q = useQuery({
    queryKey: ["ex-network"],
    queryFn: async () => {
      const [tokens, trades, wallets] = await Promise.all([
        supabase.from("tokens").select("id", { count: "exact", head: true }),
        supabase.from("trades").select("id", { count: "exact", head: true }),
        supabase.from("trades").select("wallet_address"),
      ]);
      const uniq = new Set((wallets.data ?? []).map((r) => r.wallet_address.toLowerCase()));
      return { tokens: tokens.count ?? 0, trades: trades.count ?? 0, wallets: uniq.size };
    },
  });
  const d = q.data;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat label="Tokens" value={d?.tokens ?? "—"} />
      <Stat label="Trades" value={d?.trades ?? "—"} />
      <Stat label="Wallets" value={d?.wallets ?? "—"} />
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
