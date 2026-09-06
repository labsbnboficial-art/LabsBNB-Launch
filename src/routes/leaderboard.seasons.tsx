import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/labsbnb/AppShell";
import { shortAddress } from "@/components/labsbnb/LeaderboardTable";
import { getSeasons } from "@/lib/leaderboard.functions";
import type { SeasonStatus } from "@/lib/leaderboard/leaderboard-types";

export const Route = createFileRoute("/leaderboard/seasons")({
  head: () => {
    const title = "Creator Seasons — LabsBNB Launchpad";
    const description =
      "Historial de temporadas del Creator Leaderboard en BNB Smart Chain: ganadores, participantes y reglas de cada temporada.";
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
  component: SeasonsPage,
});

export const STATUS_LABEL: Record<SeasonStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  active: "Activa",
  ended: "Finalizada",
  archived: "Archivada",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function SeasonsPage() {
  const q = useQuery({
    queryKey: ["leaderboard-seasons"],
    queryFn: () => getSeasons(),
    staleTime: 60_000,
  });
  const seasons = (q.data?.seasons ?? []).filter((s) => s.status !== "draft");

  return (
    <AppShell>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-10 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold md:text-3xl">🗓️ Creator Seasons</h1>
          <Link to="/leaderboard" className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs hover:text-accent">
            🏆 Leaderboard
          </Link>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Cada temporada mide únicamente la actividad ocurrida dentro de su ventana temporal. Las temporadas
          finalizadas son inmutables: su ranking queda congelado tal y como se calculó al cerrarlas.
        </p>

        {q.isLoading ? (
          <div className="mt-6 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass h-24 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : !seasons.length ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
            Todavía no hay temporadas publicadas.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {seasons.map((s) => (
              <Link
                key={s.id}
                to="/leaderboard/season/$slug"
                params={{ slug: s.slug }}
                className="glass block rounded-2xl p-4 transition hover:border-accent/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-semibold">{s.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {fmt(s.startsAt)} → {fmt(s.endsAt)}
                    </div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                {s.description && <p className="mt-2 text-xs text-muted-foreground">{s.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{s.participants} participantes</span>
                  {s.top3.length ? (
                    <span className="font-mono">
                      🥇 {s.top3[0]?.displayName ?? shortAddress(s.top3[0]!.address)}
                    </span>
                  ) : (
                    <span>Sin ranking todavía</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
