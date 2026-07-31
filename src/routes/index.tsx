import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useBnbPrice } from "@/lib/web3/useLabsBnbPrice";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactoryTokens, type CurveMetrics, type FactoryToken } from "@/lib/web3/onchain-token";
import { formatPrice } from "@/lib/web3/live-price";

import { Button } from "@/components/ui/button";
import { ArrowRight, Rocket, Search, Sparkles, TrendingUp, Clock, Flame, LineChart } from "lucide-react";
import { useMemo, useState } from "react";

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

const wei = (v?: string | null) => (v ? Number(v) / 1e18 : 0);

type TokenRow = {
  id: string;
  name: string;
  ticker: string;
  logo_url: string | null;
  contract_address: string | null;
  status: string;
  created_at: string;
  category: string | null;
  metrics: CurveMetrics | null;
};

function LandingPage() {
  const { t } = useI18n();
  const price = useBnbPrice();
  const [q, setQ] = useState("");

  // 1) Database rows (rich metadata) — 2) Factory `allTokens()` as source of truth.
  const dbTokens = useQuery({
    queryKey: ["tokens", "latest"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tokens")
        .select("id,name,ticker,logo_url,contract_address,status,created_at,category")
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return data ?? [];
    },
  });

  const chainTokens = useQuery({
    queryKey: ["tokens", "onchain"],
    // Live cards: refresh price / 24h volume / 24h change periodically and
    // whenever the user comes back to the tab (never while it is hidden).
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    queryFn: () => fetchFactoryTokens(24),
  });

  // Every listed token is on-chain first; the database only enriches metadata.
  const merged: TokenRow[] = useMemo(() => {
    const dbRows = (dbTokens.data ?? []) as Omit<TokenRow, "metrics">[];
    const byAddress = new Map(
      dbRows.filter((r) => r.contract_address).map((r) => [r.contract_address!.toLowerCase(), r]),
    );
    const chain = (chainTokens.data ?? []) as FactoryToken[];
    const usedDb = new Set<string>();

    const fromChain: TokenRow[] = chain.map((c) => {
      const db = byAddress.get(c.address.toLowerCase());
      if (db) usedDb.add(db.id);
      return {
        id: db?.id ?? c.address,
        name: db?.name || c.name,
        ticker: db?.ticker || c.ticker,
        logo_url: db?.logo_url ?? null,
        contract_address: c.address,
        status: db?.status ?? "on-chain",
        created_at: db?.created_at ?? new Date(0).toISOString(),
        category: db?.category ?? null,
        metrics: c.metrics,
      };
    });

    const dbOnly: TokenRow[] = dbRows
      .filter((r) => !usedDb.has(r.id))
      .map((r) => ({ ...r, metrics: null }));

    return [...fromChain, ...dbOnly];
  }, [dbTokens.data, chainTokens.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter(
      (tk) =>
        tk.name.toLowerCase().includes(needle) ||
        tk.ticker.toLowerCase().includes(needle) ||
        (tk.contract_address ?? "").toLowerCase().includes(needle),
    );
  }, [merged, q]);

  const trending = useMemo(
    () =>
      [...merged]
        .filter((tk) => wei(tk.metrics?.volume24hWei) > 0)
        .sort((a, b) => wei(b.metrics?.volume24hWei) - wei(a.metrics?.volume24hWei))
        .slice(0, 5),
    [merged],
  );

  const nearGraduation = useMemo(
    () =>
      [...merged]
        .filter((tk) => (tk.metrics?.progressBps ?? 0) > 0)
        .sort((a, b) => (b.metrics?.progressBps ?? 0) - (a.metrics?.progressBps ?? 0))
        .slice(0, 5),
    [merged],
  );

  const topGainers = useMemo(
    () =>
      [...merged]
        .filter((tk) => tk.metrics && tk.metrics.priceChangeBps !== 0)
        .sort((a, b) => (b.metrics!.priceChangeBps ?? 0) - (a.metrics!.priceChangeBps ?? 0))
        .slice(0, 5),
    [merged],
  );

  const topMarketCap = useMemo(
    () =>
      [...merged]
        .filter((tk) => wei(tk.metrics?.marketCapWei) > 0)
        .sort((a, b) => wei(b.metrics?.marketCapWei) - wei(a.metrics?.marketCapWei))
        .slice(0, 5),
    [merged],
  );

  const recentlyCreated = useMemo(
    () =>
      [...merged]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8),
    [merged],
  );

  const chainAggregates = useMemo(() => {
    const rows = merged.filter((tk) => tk.metrics);
    return {
      liquidity: rows.reduce((s, tk) => s + wei(tk.metrics!.liquidityWei), 0),
      marketCap: rows.reduce((s, tk) => s + wei(tk.metrics!.marketCapWei), 0),
      volume24h: rows.reduce((s, tk) => s + wei(tk.metrics!.volume24hWei), 0),
    };
  }, [merged]);

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
  const bnbUsd = price.data?.usd ?? 0;

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
            <StatCard
              label={t("stats.volume")}
              value={`${chainAggregates.volume24h.toFixed(3)} BNB`}
              sub={bnbUsd ? fmtUsd(chainAggregates.volume24h * bnbUsd) : "launchpad 24h"}
            />
            <StatCard label={t("stats.tokensToday")} value={String(Math.max(s?.todayTokens ?? 0, merged.filter((token) => token.created_at && Date.now() - new Date(token.created_at).getTime() <= 86_400_000).length))} />
            <StatCard label={t("stats.tokensLaunched")} value={String(Math.max(s?.totalTokens ?? 0, merged.length))} />
            <StatCard label={t("stats.users")} value={String(s?.users ?? 0)} />
            <StatCard label="Tokens" value={String(Math.max(s?.totalTokens ?? 0, merged.length))} />
            <StatCard
              label={t("stats.liquidity")}
              value={`${chainAggregates.liquidity.toFixed(3)} BNB`}
              sub={bnbUsd ? fmtUsd(chainAggregates.liquidity * bnbUsd) : "on-chain"}
            />
            <StatCard
              label={t("stats.marketCap")}
              value={`${chainAggregates.marketCap.toFixed(3)} BNB`}
              sub={bnbUsd ? fmtUsd(chainAggregates.marketCap * bnbUsd) : "on-chain"}
            />
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
          {q && (
            <button onClick={() => setQ("")} className="text-xs text-muted-foreground hover:text-foreground px-2">
              ✕
            </button>
          )}
        </div>
        {q && (
          <div className="mt-2 px-2 text-xs text-muted-foreground">
            {filtered.length} resultado{filtered.length === 1 ? "" : "s"}
          </div>
        )}
      </section>

      {/* TOKEN GRID */}
      <section className="mx-auto max-w-7xl px-4 md:px-6 mt-10 space-y-14">
        <TokenGrid
          title={t("section.latest")}
          icon={<Clock className="h-4 w-4" />}
          tokens={filtered.slice(0, 12)}
          bnbUsd={bnbUsd}
          loading={dbTokens.isLoading && chainTokens.isLoading}
          emptyLabel={q ? "Sin coincidencias para tu búsqueda." : t("empty.noTokens")}
        />

        <div className="grid gap-8 md:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Flame className="h-4 w-4 text-accent" />
              <h3 className="font-display text-lg font-semibold">{t("section.trending")}</h3>
            </div>
            {trending.length ? (
              <ul className="space-y-2">
                {trending.map((tk, i) => (
                  <TokenRowItem
                    key={tk.id}
                    rank={i + 1}
                    token={tk}
                    right={`${wei(tk.metrics?.volume24hWei).toFixed(3)} BNB`}
                    rightLabel="vol 24h"
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint label={chainTokens.isLoading ? "Leyendo la blockchain…" : "Todavía no hay volumen en las últimas 24h."} />
            )}
          </div>
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-accent" />
              <h3 className="font-display text-lg font-semibold">{t("section.nearGraduation")}</h3>
            </div>
            {nearGraduation.length ? (
              <ul className="space-y-2">
                {nearGraduation.map((tk, i) => (
                  <TokenRowItem
                    key={tk.id}
                    rank={i + 1}
                    token={tk}
                    right={`${((tk.metrics?.progressBps ?? 0) / 100).toFixed(2)}%`}
                    rightLabel="bonding curve"
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint label={chainTokens.isLoading ? "Leyendo la blockchain…" : "Ninguna curva ha avanzado todavía."} />
            )}
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-success" />
              <h3 className="font-display text-lg font-semibold">Top gainers 24h</h3>
            </div>
            {topGainers.length ? (
              <ul className="space-y-2">
                {topGainers.map((tk, i) => (
                  <TokenRowItem
                    key={tk.id}
                    rank={i + 1}
                    token={tk}
                    right={`${(tk.metrics!.priceChangeBps / 100) >= 0 ? "+" : ""}${(tk.metrics!.priceChangeBps / 100).toFixed(2)}%`}
                    rightLabel="cambio 24h"
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint label={chainTokens.isLoading ? "Leyendo la blockchain…" : "Sin variación de precio en 24h."} />
            )}
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <LineChart className="h-4 w-4 text-accent" />
              <h3 className="font-display text-lg font-semibold">Top market cap</h3>
            </div>
            {topMarketCap.length ? (
              <ul className="space-y-2">
                {topMarketCap.map((tk, i) => (
                  <TokenRowItem
                    key={tk.id}
                    rank={i + 1}
                    token={tk}
                    right={`${wei(tk.metrics?.marketCapWei).toFixed(3)} BNB`}
                    rightLabel="market cap"
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint label={chainTokens.isLoading ? "Leyendo la blockchain…" : "Sin datos de market cap todavía."} />
            )}
          </div>
        </div>

        <TokenGrid
          title="Recién creados"
          icon={<Sparkles className="h-4 w-4" />}
          tokens={recentlyCreated}
          bnbUsd={bnbUsd}
          loading={dbTokens.isLoading && chainTokens.isLoading}
          emptyLabel={t("empty.noTokens")}
        />
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

function TokenAvatar({ token, size = "h-10 w-10" }: { token: TokenRow; size?: string }) {
  return token.logo_url ? (
    <img src={token.logo_url} alt={`${token.name} logo`} className={`${size} rounded-full object-cover`} />
  ) : (
    <div className={`${size} rounded-full brand-gradient grid place-items-center font-bold text-sm text-primary-foreground`}>
      {token.ticker[0]}
    </div>
  );
}

function TokenRowItem({
  token,
  rank,
  right,
  rightLabel,
}: {
  token: TokenRow;
  rank: number;
  right: string;
  rightLabel: string;
}) {
  return (
    <li>
      <Link
        to="/token/$address"
        params={{ address: token.contract_address ?? token.id }}
        className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 hover:border-accent/40 transition"
      >
        <span className="w-4 text-xs font-mono text-muted-foreground">{rank}</span>
        <TokenAvatar token={token} size="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{token.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">${token.ticker}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm">{right}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{rightLabel}</div>
        </div>
      </Link>
    </li>
  );
}

function TokenGrid({
  title,
  icon,
  tokens,
  loading,
  emptyLabel,
  bnbUsd,
}: {
  title: string;
  icon: React.ReactNode;
  tokens: TokenRow[];
  loading: boolean;
  emptyLabel: string;
  bnbUsd: number;
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
            <div key={i} className="glass rounded-2xl p-4 h-56 animate-pulse" />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <EmptyHint label={emptyLabel} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tokens.map((tk) => {
            const m = tk.metrics;
            const change = (m?.priceChangeBps ?? 0) / 100;
            const progress = Math.min(100, (m?.progressBps ?? 0) / 100);
            const mcapBnb = wei(m?.marketCapWei);
            return (
              <Link
                key={tk.id}
                to="/token/$address"
                params={{ address: tk.contract_address ?? tk.id }}
                className="glass rounded-2xl p-4 hover:border-accent/40 transition group flex flex-col"
              >
                <div className="flex items-center gap-3">
                  <TokenAvatar token={tk} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{tk.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">${tk.ticker}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="uppercase tracking-wider text-muted-foreground">Price</div>
                    <div className="font-mono tabular-nums">{m ? `${formatPrice(m.priceWei)} BNB` : "—"}</div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wider text-muted-foreground">Market cap</div>
                    <div className="font-mono">
                      {m ? (bnbUsd ? fmtUsd(mcapBnb * bnbUsd) : `${mcapBnb.toFixed(3)} BNB`) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wider text-muted-foreground">24h</div>
                    <div className={`font-mono ${change >= 0 ? "text-success" : "text-destructive"}`}>
                      {m ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wider text-muted-foreground">Vol 24h</div>
                    <div className="font-mono">{m ? `${wei(m.volume24hWei).toFixed(3)}` : "—"}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Bonding curve</span>
                    <span className="font-mono text-foreground">{progress.toFixed(2)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full brand-gradient" style={{ width: `${Math.max(progress, 1)}%` }} />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">
                    {tk.status}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full brand-gradient px-3 py-1 text-[11px] font-medium text-primary-foreground">
                    <LineChart className="h-3 w-3" />
                    Ver gráfico / Comprar
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
