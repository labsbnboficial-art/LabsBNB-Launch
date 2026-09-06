import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trophy } from "lucide-react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { CreatorBadges, CreatorScoreChip } from "@/components/labsbnb/CreatorBadges";
import { CreatorLevelBadge } from "@/components/labsbnb/CreatorLevelBadge";
import { getTopCreators } from "@/lib/creator.functions";

export const Route = createFileRoute("/creators")({
  head: () => ({
    meta: [
      { title: "Top Creators — LabsBNB Launchpad" },
      {
        name: "description",
        content:
          "Public creator reputation ranking on BNB Smart Chain: Creator Score, launched tokens, graduations, organic volume and best trending rank.",
      },
      { property: "og:title", content: "Top Creators — LabsBNB Launchpad" },
      {
        property: "og:description",
        content: "Creator reputation built only from real on-chain launchpad activity. No rewards, no simulated data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreatorsPage,
});

const SORTS = [
  { id: "score", label: "Creator Score" },
  { id: "graduations", label: "Graduations" },
  { id: "volume", label: "Organic Volume" },
  { id: "trending", label: "Trending" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

function CreatorsPage() {
  const [sort, setSort] = useState<SortId>("score");
  const q = useQuery({
    queryKey: ["creators", sort],
    queryFn: () => getTopCreators({ data: { sort, limit: 50 } }),
    staleTime: 120_000,
    refetchInterval: 300_000,
  });
  const rows = q.data?.creators ?? [];

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-accent" />
          <h1 className="font-display text-2xl font-bold md:text-3xl">🏆 Top Creators</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Reputación pública calculada en el servidor con datos reales de BNB Chain (chain 56): calidad de
          lanzamientos, actividad orgánica, comunidad, bonding curve y desempeño en Trending. No otorga
          recompensas ni puntos canjeables.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                sort === s.id
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          {q.isLoading && !q.data ? (
            Array.from({ length: 5 }).map((_, i) => <div key={i} className="glass h-16 animate-pulse rounded-xl" />)
          ) : rows.length ? (
            rows.map((c) => (
              <Link
                key={c.address}
                to="/creator/$address"
                params={{ address: c.address }}
                className="glass flex flex-col gap-2 rounded-xl p-3 transition hover:border-accent/40 md:flex-row md:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">#{c.rank}</span>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5">👤</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {c.displayName ?? `${c.address.slice(0, 6)}...${c.address.slice(-4)}`}
                    </div>
                    <CreatorBadges badges={c.badges} limit={3} />
                  </div>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                  <Cell label="Tokens" value={String(c.tokensCreated)} />
                  <Cell label="Graduated" value={String(c.graduatedTokens)} />
                  <Cell label="Organic vol" value={`${c.organicVolume24h.toFixed(4)} BNB`} />
                  <Cell label="Best trending" value={c.bestTrendingRank == null ? "N/A" : `#${c.bestTrendingRank}`} />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {c.creatorLevel && (
                    <CreatorLevelBadge
                      level={c.creatorLevel.level}
                      name={c.creatorLevel.name}
                      icon={c.creatorLevel.icon}
                      size="sm"
                      showPoints
                      points={c.creatorPoints}
                    />
                  )}
                  <CreatorScoreChip score={c.score} />
                </div>

              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
              Todavía no hay creadores con actividad medible on-chain.
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}
