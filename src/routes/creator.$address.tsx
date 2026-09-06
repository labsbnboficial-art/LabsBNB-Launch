import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/labsbnb/AppShell";
import { CreatorBadges, CreatorScoreChip } from "@/components/labsbnb/CreatorBadges";
import { getCreator } from "@/lib/creator.functions";
import { CREATOR_WEIGHTS, EVENT_LABEL, type CreatorProfile, type CreatorTokenRow } from "@/lib/creator/creator-types";
import { CreatorPointsSection } from "@/components/labsbnb/CreatorPoints";
import { CreatorLevelSection } from "@/components/labsbnb/CreatorLevelBadge";
import { CreatorLevelHistorySection } from "@/components/labsbnb/CreatorLevelHistory";
import { CreatorAchievementsSection } from "@/components/labsbnb/CreatorAchievements";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";

export const Route = createFileRoute("/creator/$address")({
  head: ({ params }) => {
    const short = `${params.address.slice(0, 6)}...${params.address.slice(-4)}`;
    const title = `Creator ${short} — LabsBNB Launchpad`;
    const description = `Public reputation, launched tokens, bonding progress and trending performance of creator ${short} on BNB Smart Chain.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: CreatorPage,
});

const na = (v: number | null | undefined, fn: (n: number) => string) => (v == null ? "N/A" : fn(v));
const bnb = (v: number) => `${v.toFixed(4)} BNB`;
const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "N/A";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-base tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ScoreBreakdown({ profile }: { profile: CreatorProfile }) {
  const rows: { key: keyof typeof CREATOR_WEIGHTS; label: string }[] = [
    { key: "launchQuality", label: "Launch Quality" },
    { key: "organicActivity", label: "Organic Activity" },
    { key: "communityGrowth", label: "Community Growth" },
    { key: "bondingPerformance", label: "Bonding Performance" },
    { key: "trendingPerformance", label: "Trending Performance" },
  ];
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">🔥 Creator Reputation</h2>
        <CreatorScoreChip score={profile.score} size="lg" />
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const value = profile.parts[r.key];
          return (
            <div key={r.key} className="text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  {r.label} <span className="text-[10px]">({CREATOR_WEIGHTS[r.key]}%)</span>
                </span>
                <span className="font-mono tabular-nums">{value == null ? "N/A" : `${value}/100`}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div className="h-full brand-gradient" style={{ width: `${value ?? 0}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Cuando un componente no tiene datos reales on-chain se muestra N/A y su peso se reparte entre los
        componentes disponibles. La reputación no es dinero ni otorga recompensas.
      </p>
    </div>
  );
}

function TokenRow({ t }: { t: CreatorTokenRow }) {
  return (
    <Link
      to="/token/$address"
      params={{ address: t.address }}
      className="glass flex flex-col gap-2 rounded-xl p-3 transition hover:border-accent/40 md:flex-row md:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {t.logo ? (
          <img src={t.logo} alt={`${t.name} logo`} loading="lazy" className="h-9 w-9 rounded-lg object-cover" />
        ) : (
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-xs">
            {t.symbol.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm">{t.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">
            ${t.symbol} · {t.address.slice(0, 6)}…{t.address.slice(-4)}
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2 text-[11px] md:grid-cols-6">
        <Cell label="Price" value={t.price == null ? "N/A" : Number(t.price).toPrecision(4)} />
        <Cell
          label="24h"
          value={na(t.priceChange24h, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`)}
          tone={t.priceChange24h == null ? undefined : t.priceChange24h >= 0 ? "text-success" : "text-destructive"}
        />
        <Cell label="Vol 24h" value={bnb(t.volume24h)} />
        <Cell label="Holders" value={na(t.holders, String)} />
        <Cell label="Bonding" value={na(t.bondingProgress, (n) => `${n.toFixed(1)}%`)} />
        <Cell label="Trending" value={`${t.trendingScore}`} />
      </div>
      <div className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
        {t.graduated ? "🚀 Graduated" : t.status.replace("_", " ")}
      </div>
    </Link>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

type SortKey = "default" | "volume" | "bonding" | "trending" | "holders";
type FilterKey = "all" | "active" | "near_graduation" | "graduated";

function CreatorPage() {
  const { address } = Route.useParams();
  const [sort, setSort] = useState<SortKey>("default");
  const [filter, setFilter] = useState<FilterKey>("all");

  const q = useQuery({
    queryKey: ["creator", address.toLowerCase()],
    queryFn: () => getCreator({ data: { address } }),
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const profile = q.data?.profile ?? null;

  const tokens = useMemo(() => {
    let list = profile?.tokens ?? [];
    if (filter !== "all") {
      list = list.filter((t) => (filter === "graduated" ? t.graduated : t.status === filter));
    }
    if (sort === "volume") list = [...list].sort((a, b) => b.volume24h - a.volume24h);
    if (sort === "bonding") list = [...list].sort((a, b) => (b.bondingProgress ?? -1) - (a.bondingProgress ?? -1));
    if (sort === "trending") list = [...list].sort((a, b) => b.trendingScore - a.trendingScore);
    if (sort === "holders") list = [...list].sort((a, b) => (b.holders ?? -1) - (a.holders ?? -1));
    return list;
  }, [profile, sort, filter]);

  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <div className="glass rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-xl">👤</div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold md:text-2xl">
                {profile?.customization.displayName ?? short}
              </h1>
              <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span>{short}</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(address);
                    toast.success("Dirección copiada");
                  }}
                  className="hover:text-foreground"
                  aria-label="Copiar dirección"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <a
                  href={`${ACTIVE_NETWORK.explorer}/address/${address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  BscScan <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            {profile && <CreatorScoreChip score={profile.score} size="lg" />}
          </div>

          {profile?.customization.bio && (
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{profile.customization.bio}</p>
          )}

          {profile && (
            <>
              <div className="mt-4">
                <CreatorBadges badges={profile.badges} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
                <Stat label="Tokens" value={String(profile.stats.tokensCreated)} />
                <Stat label="Graduated" value={String(profile.stats.graduatedTokens)} />
                <Stat label="Active" value={String(profile.stats.activeTokens)} />
                <Stat label="Creator since" value={dt(profile.stats.firstLaunchAt)} />
                <Stat label="Last launch" value={dt(profile.stats.lastLaunchAt)} />
                <Stat label="Best trending" value={na(profile.stats.bestTrendingRank, (n) => `#${n}`)} />
              </div>
            </>
          )}
        </div>

        {q.isLoading && !q.data ? (
          <div className="mt-4 glass h-48 animate-pulse rounded-2xl" />
        ) : !profile ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
            No encontramos tokens creados por esta dirección en BNB Chain (chain 56).
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <ScoreBreakdown profile={profile} />

              <div className="glass rounded-2xl p-4">
                <h2 className="mb-3 font-display text-sm font-semibold">📊 Statistics</h2>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Volume 24h" value={bnb(profile.stats.volume24h)} />
                  <Stat label="Organic volume" value={bnb(profile.stats.organicVolume24h)} />
                  <Stat label="Trades 24h" value={String(profile.stats.trades24h)} />
                  <Stat label="Unique buyers" value={String(profile.stats.uniqueBuyers)} />
                  <Stat label="Unique sellers" value={String(profile.stats.uniqueSellers)} />
                  <Stat label="Holders" value={na(profile.stats.holders, String)} />
                  <Stat label="Avg bonding" value={na(profile.stats.avgBondingProgress, (n) => `${n.toFixed(1)}%`)} />
                  <Stat label="Max bonding" value={na(profile.stats.maxBondingProgress, (n) => `${n.toFixed(1)}%`)} />
                </div>
              </div>

              <div className="glass rounded-2xl p-4">
                <h2 className="mb-3 font-display text-sm font-semibold">🏆 Best Performer</h2>
                {profile.bestPerformer ? (
                  <div className="space-y-2 text-xs">
                    <Link
                      to="/token/$address"
                      params={{ address: profile.bestPerformer.address }}
                      className="flex items-center gap-2 text-sm hover:text-accent"
                    >
                      {profile.bestPerformer.logo && (
                        <img
                          src={profile.bestPerformer.logo}
                          alt={`${profile.bestPerformer.name} logo`}
                          className="h-8 w-8 rounded-lg object-cover"
                        />
                      )}
                      <span className="truncate">
                        {profile.bestPerformer.name}{" "}
                        <span className="font-mono text-muted-foreground">${profile.bestPerformer.symbol}</span>
                      </span>
                    </Link>
                    <Stat
                      label="Trending rank"
                      value={na(profile.bestPerformer.bestTrendingRank, (n) => `#${n}`)}
                    />
                    <Stat label="Bonding" value={na(profile.bestPerformer.bondingProgress, (n) => `${n.toFixed(1)}%`)} />
                    <Stat label="Volume 24h" value={bnb(profile.bestPerformer.volume24h)} />
                    <Stat label="Holders" value={na(profile.bestPerformer.holders, String)} />
                    <Stat label="Graduated" value={profile.bestPerformer.graduated ? "Yes" : "No"} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">N/A</p>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">🚀 Created Tokens</h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as FilterKey)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1"
                    aria-label="Filtrar tokens"
                  >
                    <option value="all">Todos</option>
                    <option value="active">Activos</option>
                    <option value="near_graduation">Near graduation</option>
                    <option value="graduated">Graduados</option>
                  </select>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1"
                    aria-label="Ordenar tokens"
                  >
                    <option value="default">Orden recomendado</option>
                    <option value="trending">Trending Score</option>
                    <option value="volume">Volumen 24h</option>
                    <option value="bonding">Bonding</option>
                    <option value="holders">Holders</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                {tokens.length ? (
                  tokens.map((t) => <TokenRow key={t.address} t={t} />)
                ) : (
                  <p className="text-sm text-muted-foreground">Sin tokens para este filtro.</p>
                )}
              </div>
            </div>

            <CreatorLevelSection address={address} />

            <CreatorLevelHistorySection address={address} />

            <CreatorAchievementsSection address={address} />

            <CreatorPointsSection address={address} />

            <div className="mt-6 glass rounded-2xl p-4">
              <h2 className="mb-3 font-display text-sm font-semibold">📊 Creator Activity</h2>
              {profile.timeline.length ? (
                <ol className="space-y-3">
                  {profile.timeline.map((e, i) => (
                    <li key={`${e.kind}-${e.token}-${i}`} className="flex gap-3 text-xs">
                      <span className="w-28 shrink-0 font-mono text-muted-foreground">
                        {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <span>
                        {EVENT_LABEL[e.kind]} — <span className="font-mono">${e.symbol || "?"}</span>
                        {e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Todavía no hay eventos históricos registrados para este creador.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
