import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchLaunchTokens } from "@/lib/token-list";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Trophy, Flame, Sparkles, ArrowUp, ArrowDown, Check } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/ranking")({
  head: () => ({
    meta: [
      { title: "Ranking — LabsBNB Launchpad" },
      { name: "description", content: "Top tokens by volume, gainers, trending and graduated on LabsBNB." },
      { property: "og:title", content: "Ranking — LabsBNB Launchpad" },
      { property: "og:description", content: "Top tokens across the LabsBNB Launchpad." },
    ],
  }),
  component: RankingPage,
});

const TABS = [
  { key: "new", label: "New", icon: Sparkles },
  { key: "trending", label: "Trending", icon: Flame },
  { key: "gainers", label: "Top gainers", icon: ArrowUp },
  { key: "losers", label: "Top losers", icon: ArrowDown },
  { key: "graduated", label: "Graduated", icon: Check },
] as const;

function RankingPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("new");

  const q = useQuery({
    queryKey: ["ranking", tab],
    refetchInterval: 15_000,
    queryFn: async () => {
      const tokens = await fetchLaunchTokens(50);
      if (tab === "graduated") return tokens.filter((token) => token.status === "graduated" || (token.metrics?.progressBps ?? 0) >= 10_000);
      if (tab === "trending") return tokens.sort((a, b) => Number(BigInt(b.metrics?.volume24hWei ?? "0") - BigInt(a.metrics?.volume24hWei ?? "0")));
      if (tab === "gainers") return tokens.filter((token) => (token.metrics?.priceChangeBps ?? 0) > 0).sort((a, b) => (b.metrics?.priceChangeBps ?? 0) - (a.metrics?.priceChangeBps ?? 0));
      if (tab === "losers") return tokens.filter((token) => (token.metrics?.priceChangeBps ?? 0) < 0).sort((a, b) => (a.metrics?.priceChangeBps ?? 0) - (b.metrics?.priceChangeBps ?? 0));
      return tokens;
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
            <Trophy className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Ranking</h1>
            <p className="text-sm text-muted-foreground">Rankings populate as trades and prices are indexed on-chain.</p>
          </div>
        </div>

        <div className="glass rounded-2xl p-2 mb-6 flex gap-1 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm whitespace-nowrap transition ${tab === key ? "brand-gradient text-primary-foreground glow-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="glass rounded-2xl divide-y divide-white/5">
          {q.data && q.data.length > 0 ? (
            q.data.map((tk, i) => (
              <Link
                to="/token/$address"
                params={{ address: tk.contract_address ?? tk.id }}
                key={tk.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-white/5 transition"
              >
                <span className="font-mono text-xs text-muted-foreground w-6">{i + 1}</span>
                {tk.logo_url ? (
                  <img src={tk.logo_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-full brand-gradient grid place-items-center text-sm font-bold text-primary-foreground">{tk.ticker[0]}</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{tk.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">${tk.ticker}</div>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">{tk.status}</span>
                  {tab === "trending" && <span className="text-xs font-mono">{(Number(tk.metrics?.volume24hWei ?? "0") / 1e18).toFixed(3)} BNB</span>}
                  {(tab === "gainers" || tab === "losers") && <span className={tab === "gainers" ? "text-success text-xs" : "text-destructive text-xs"}>{((tk.metrics?.priceChangeBps ?? 0) / 100).toFixed(2)}%</span>}
                </div>
              </Link>
            ))
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">No tokens yet in this category.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
