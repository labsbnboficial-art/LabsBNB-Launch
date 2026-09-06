import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trophy } from "lucide-react";
import { AppShell } from "@/components/labsbnb/AppShell";
import {
  CATEGORY_LABEL,
  LeaderboardList,
  LeaderboardPodium,
  MetricNotice,
} from "@/components/labsbnb/LeaderboardTable";
import { getActiveSeason, getLeaderboard } from "@/lib/leaderboard.functions";
import { LEADERBOARD_CATEGORIES, type LeaderboardCategory } from "@/lib/leaderboard/leaderboard-types";

export const Route = createFileRoute("/leaderboard/")({
  head: () => {
    const title = "Creator Leaderboard — LabsBNB Launchpad";
    const description =
      "Ranking público de creadores en BNB Smart Chain: Creator Points, Creator Score, graduaciones, trending y volumen orgánico. Solo datos reales on-chain.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const [category, setCategory] = useState<LeaderboardCategory>("overall");
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["leaderboard", category, page],
    queryFn: () => getLeaderboard({ data: { category, page, pageSize: 25 } }),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const season = useQuery({
    queryKey: ["leaderboard-active-season"],
    queryFn: () => getActiveSeason(),
    staleTime: 60_000,
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const active = season.data?.season ?? null;

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-accent" />
            <h1 className="font-display text-2xl font-bold md:text-3xl">🏆 Creator Leaderboard</h1>
          </div>
          <Link
            to="/leaderboard/seasons"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs hover:text-accent"
          >
            🗓️ Temporadas
          </Link>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Ranking calculado en el servidor con actividad real de BNB Chain (chain 56): Creator Points, Creator
          Score, graduaciones, desempeño en Trending y volumen orgánico. No otorga recompensas económicas ni
          modifica puntos: solo ordena lo que ya existe.
        </p>

        {active && (
          <Link
            to="/leaderboard/season/$slug"
            params={{ slug: active.slug }}
            className="glass mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 transition hover:border-accent/40"
          >
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Temporada activa</div>
              <div className="font-display text-lg font-semibold">🗓️ {active.name}</div>
              {active.description && <p className="text-xs text-muted-foreground">{active.description}</p>}
            </div>
            <div className="text-right text-xs">
              <div className="font-mono tabular-nums">
                {active.countdown.ended
                  ? "Finalizando…"
                  : `${active.countdown.days}d ${active.countdown.hours}h ${active.countdown.minutes}m`}
              </div>
              <div className="text-muted-foreground">{active.participants} participantes</div>
            </div>
          </Link>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {LEADERBOARD_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                category === c
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        {data?.updating && (
          <p className="mt-3 text-[11px] text-warning">
            Actualizando datos on-chain: algunas métricas pueden mostrarse como N/A durante unos minutos.
          </p>
        )}
        {data && <MetricNotice metrics={data.unavailableMetrics} />}

        {q.isLoading && !data ? (
          <div className="mt-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass h-16 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {page === 1 && data && <div className="mt-5"><LeaderboardPodium top3={data.top3} /></div>}
            <div className="mt-4">
              <LeaderboardList entries={data?.entries ?? []} />
            </div>
            {data && data.total > data.pageSize && (
              <div className="mt-4 flex items-center justify-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
