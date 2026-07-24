import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useBnbPrice } from "@/lib/web3/useLabsBnbPrice";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowRight, Rocket, Search, Sparkles, TrendingUp, Clock, Flame } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LabsBNB Launchpad — Launch tokens on BNB Chain" },
      { name: "description", content: "Create, launch and trade tokens with virtual bonding curves. Zero deploy fees. Part of the LabsBNB ecosystem." },
      { property: "og:title", content: "LabsBNB Launchpad — Launch tokens on BNB Chain" },
      { property: "og:description", content: "Create, launch and trade tokens with virtual bonding curves. Zero deploy fees. Part of the LabsBNB ecosystem." },
    ],
  }),
  component: LandingPage,
});

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-display text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function fmtUsd(n?: number) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function LandingPage() {
  const { t } = useI18n();
  const price = useBnbPrice();
  const [q, setQ] = useState("");

  const tokensQuery = useQuery({
    queryKey: ["tokens", "latest", q],
    queryFn: async () => {
      let query = supabase
        .from("tokens")
        .select("id,name,ticker,logo_url,contract_address,status,created_at,category")
        .order("created_at", { ascending: false })
        .limit(12);
      if (q.trim()) query = query.or(`name.ilike.%${q}%,ticker.ilike.%${q}%,contract_address.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const statsQuery = useQuery({
    queryKey: ["landing-stats"],
    queryFn: async () => {
      const [totalTokens, todayTokens, users, launched] = await Promise.all([
        supabase.from("tokens").select("*", { count: "exact", head: true }),
        supabase.from("tokens").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("tokens").select("*", { count: "exact", head: true }).eq("status", "graduated"),
      ]);
      return {
        totalTokens: totalTokens.count ?? 0,
        todayTokens: todayTokens.count ?? 0,
        users: users.count ?? 0,
        launched: launched.count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  const s = statsQuery.data;

  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden hero-bg">
        <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full glass px-3.5 py-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span className="text-muted-foreground">{t("hero.badge")}</span>
            </div>
            <h1 className="mt-6 font-display text-4xl md:text-6xl font-bold leading-[1.05]">
              {t("hero.title").split(" ").slice(0, -3).join(" ")}{" "}
              <span className="text-gradient">{t("hero.title").split(" ").slice(-3).join(" ")}</span>
            </h1>
            <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-2xl">{t("hero.subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/create">
                <Button className="h-11 px-6 brand-gradient text-primary-foreground font-medium glow-primary hover:opacity-90">
                  <Rocket className="h-4 w-4 mr-2" />
                  {t("hero.cta.create")}
                </Button>
              </Link>
              <a href="#tokens">
                <Button variant="outline" className="h-11 px-6 border-white/10 bg-white/5 hover:bg-white/10">
                  {t("hero.cta.explore")}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </a>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              label={"BNB / USD"}
              value={price.data ? `$${price.data.usd.toFixed(2)}` : "—"}
              sub={price.data ? `${price.data.change24h >= 0 ? "+" : ""}${price.data.change24h.toFixed(2)}% 24h` : undefined}
            />
            <StatCard label={t("stats.volume")} value={fmtUsd(price.data?.volume24h)} sub="BNB market" />
            <StatCard label={t("stats.tokensToday")} value={String(s?.todayTokens ?? 0)} />
            <StatCard label={t("stats.tokensLaunched")} value={String(s?.launched ?? 0)} />
            <StatCard label={t("stats.users")} value={String(s?.users ?? 0)} />
            <StatCard label="Tokens" value={String(s?.totalTokens ?? 0)} />
            <StatCard label={t("stats.liquidity")} value="—" sub="on-chain indexer" />
            <StatCard label={t("stats.marketCap")} value="—" sub="pending index" />
          </div>
        </div>
      </section>

      {/* SEARCH */}
      <section id="tokens" className="mx-auto max-w-7xl px-4 md:px-6 mt-4">
        <div className="glass-strong rounded-2xl p-3 flex items-center gap-3">
          <Search className="h-4 w-4 text-muted-foreground ml-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>
      </section>

      {/* TOKEN GRID */}
      <section className="mx-auto max-w-7xl px-4 md:px-6 mt-10 space-y-14">
        <TokenGrid
          title={t("section.latest")}
          icon={<Clock className="h-4 w-4" />}
          tokens={tokensQuery.data ?? []}
          loading={tokensQuery.isLoading}
          emptyLabel={t("empty.noTokens")}
        />

        <div className="grid gap-8 md:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Flame className="h-4 w-4 text-accent" />
              <h3 className="font-display text-lg font-semibold">{t("section.trending")}</h3>
            </div>
            <EmptyHint label={t("empty.noTokens")} />
          </div>
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-accent" />
              <h3 className="font-display text-lg font-semibold">{t("section.nearGraduation")}</h3>
            </div>
            <EmptyHint label={t("empty.noTokens")} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

type TokenRow = {
  id: string;
  name: string;
  ticker: string;
  logo_url: string | null;
  contract_address: string | null;
  status: string;
  created_at: string;
  category: string | null;
};

function TokenGrid({
  title,
  icon,
  tokens,
  loading,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  tokens: TokenRow[];
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-accent">{icon}</span>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
      </div>
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass rounded-2xl p-4 h-40 animate-pulse" />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <EmptyHint label={emptyLabel} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tokens.map((tk) => (
            <Link
              key={tk.id}
              to="/token/$address"
              params={{ address: tk.contract_address ?? tk.id }}
              className="glass rounded-2xl p-4 hover:border-accent/40 transition group"
            >
              <div className="flex items-center gap-3">
                {tk.logo_url ? (
                  <img src={tk.logo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded-full brand-gradient grid place-items-center font-bold text-sm text-primary-foreground">
                    {tk.ticker[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">{tk.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">${tk.ticker}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                {tk.category ?? "—"}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px]">
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted-foreground uppercase tracking-wider">
                  {tk.status}
                </span>
                <span className="text-accent group-hover:translate-x-0.5 transition">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
