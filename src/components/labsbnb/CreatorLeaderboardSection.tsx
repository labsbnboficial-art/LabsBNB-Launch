// Leaderboard block rendered inside /creator/:address.
// Read-only: position, movement, best/worst rank and current season standing.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getCreatorLeaderboardPosition } from "@/lib/leaderboard.functions";

const na = (v: number | null | undefined, fn: (n: number) => string) => (v == null ? "N/A" : fn(v));

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function CreatorLeaderboardSection({ address }: { address: string }) {
  const q = useQuery({
    queryKey: ["creator-leaderboard", address.toLowerCase()],
    queryFn: () => getCreatorLeaderboardPosition({ data: { address } }),
    staleTime: 60_000,
  });

  const d = q.data;

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🏆 Leaderboard</h2>
        <Link to="/leaderboard" className="text-[11px] text-muted-foreground hover:text-accent">
          Ver ranking completo →
        </Link>
      </div>

      {q.isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-white/5" />
      ) : !d ? (
        <p className="text-xs text-muted-foreground">Ranking no disponible en este momento.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Posición" value={na(d.currentRank, (n) => `#${n}`)} />
            <Stat
              label="Movimiento"
              value={
                d.isNew
                  ? "NEW"
                  : d.rankChange == null || d.rankChange === 0
                    ? "—"
                    : `${d.rankChange > 0 ? "▲" : "▼"} ${Math.abs(d.rankChange)}`
              }
              tone={d.rankChange == null || d.rankChange === 0 ? undefined : d.rankChange > 0 ? "text-success" : "text-destructive"}
            />
            <Stat label="Mejor posición" value={na(d.bestRank, (n) => `#${n}`)} />
            <Stat label="Overall" value={na(d.overallScore, (n) => n.toFixed(1))} />
          </div>

          {d.season ? (
            <Link
              to="/leaderboard/season/$slug"
              params={{ slug: d.season.slug }}
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs transition hover:border-accent/40"
            >
              <span>🗓️ {d.season.name}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {na(d.season.rank, (n) => `#${n}`)} · {na(d.season.score, (n) => n.toFixed(1))}
              </span>
            </Link>
          ) : (
            <p className="mt-3 text-[11px] text-muted-foreground">No hay ninguna temporada activa ahora mismo.</p>
          )}

          {!d.storageReady && (
            <p className="mt-3 text-[11px] text-warning">
              El historial de posiciones aún no está disponible: falta ejecutar la migración del leaderboard.
            </p>
          )}
        </>
      )}
    </div>
  );
}
