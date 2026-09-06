import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { LeaderboardList, LeaderboardPodium, naNum, shortAddress } from "@/components/labsbnb/LeaderboardTable";
import { STATUS_LABEL } from "./leaderboard.seasons";
import { getSeason } from "@/lib/leaderboard.functions";
import { METRIC_LABEL, type LeaderboardMetric } from "@/lib/leaderboard/leaderboard-types";

export const Route = createFileRoute("/leaderboard/season/$slug")({
  head: ({ params }) => {
    const title = `Season ${params.slug} — LabsBNB Creator Leaderboard`;
    const description = `Clasificación de la temporada ${params.slug} del Creator Leaderboard de LabsBNB en BNB Smart Chain, con datos reales on-chain.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: SeasonDetailPage,
});

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const TABS = [
  { id: "rankings", label: "Rankings" },
  { id: "stats", label: "Statistics" },
  { id: "rules", label: "Reglas" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SeasonDetailPage() {
  const { slug } = Route.useParams();
  const [tab, setTab] = useState<TabId>("rankings");

  const q = useQuery({
    queryKey: ["leaderboard-season", slug],
    queryFn: () => getSeason({ data: { slug } }),
    staleTime: 30_000,
  });

  const season = q.data?.season ?? null;
  const standings = q.data?.standings ?? [];

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <Link to="/leaderboard/seasons" className="text-xs text-muted-foreground hover:text-accent">
          ← Todas las temporadas
        </Link>

        {q.isLoading ? (
          <div className="glass mt-4 h-40 animate-pulse rounded-2xl" />
        ) : !season ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
            No encontramos esta temporada.
          </div>
        ) : (
          <>
            <div className="glass mt-4 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold">🗓️ {season.name}</h1>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {fmt(season.startsAt)} → {fmt(season.endsAt)}
                  </div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                  {STATUS_LABEL[season.status]}
                </span>
              </div>
              {season.description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{season.description}</p>}
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Participantes" value={String(season.participants)} />
                <Stat label="Estado" value={STATUS_LABEL[season.status]} />
                <Stat label="Ranking" value={q.data?.final ? "Final (inmutable)" : "En vivo"} />
                <Stat
                  label="Último snapshot"
                  value={q.data?.snapshotAt ? new Date(q.data.snapshotAt).toLocaleString() : "N/A"}
                />
              </div>
              {q.data?.updating && (
                <p className="mt-3 text-[11px] text-warning">
                  Algunas métricas se están actualizando; los valores no disponibles aparecen como N/A.
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    tab === t.id
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "rankings" && (
              <>
                <div className="mt-5">
                  <LeaderboardPodium top3={standings.slice(0, 3)} />
                </div>
                <div className="mt-4">
                  <LeaderboardList
                    entries={standings}
                    emptyLabel="Todavía no hay actividad medible dentro de la ventana de esta temporada."
                  />
                </div>
              </>
            )}

            {tab === "stats" && (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <Stat label="Creadores clasificados" value={String(standings.length)} />
                <Stat
                  label="Graduaciones en temporada"
                  value={String(standings.reduce((s, e) => s + (e.raw.graduations ?? 0), 0))}
                />
                <Stat
                  label="Creator Points en temporada"
                  value={naNum(
                    standings.some((e) => e.raw.points != null)
                      ? standings.reduce((s, e) => s + (e.raw.points ?? 0), 0)
                      : null,
                    (n) => n.toLocaleString(),
                  )}
                />
                <Stat
                  label="Mejor puntuación"
                  value={standings.length ? standings[0]!.overallScore.toFixed(1) : "N/A"}
                />
                <Stat
                  label="Ganador"
                  value={standings.length ? (standings[0]!.displayName ?? shortAddress(standings[0]!.address)) : "N/A"}
                />
                <Stat label="Chain" value="BNB Smart Chain (56)" />
              </div>
            )}

            {tab === "rules" && (
              <div className="glass mt-5 rounded-2xl p-4">
                <h2 className="mb-3 font-display text-sm font-semibold">⚖️ Pesos de la temporada</h2>
                <div className="space-y-2">
                  {(Object.keys(season.rules.weights) as LeaderboardMetric[]).map((m) => (
                    <div key={m} className="text-xs">
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted-foreground">{METRIC_LABEL[m]}</span>
                        <span className="font-mono tabular-nums">{season.rules.weights[m]}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                        <div className="h-full brand-gradient" style={{ width: `${season.rules.weights[m]}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Solo cuenta la actividad ocurrida entre el inicio y el fin de la temporada. Si una métrica no
                  tiene datos reales se muestra N/A y su peso se reparte entre las disponibles.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}
