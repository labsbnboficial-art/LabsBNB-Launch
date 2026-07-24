import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
    queryFn: async () => {
      let query = supabase.from("tokens").select("id,name,ticker,logo_url,contract_address,status,created_at").limit(50);
      if (tab === "graduated") query = query.eq("status", "graduated");
      query = query.order("created_at", { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
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
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{tk.status}</span>
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
