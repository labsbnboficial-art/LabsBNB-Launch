// 🏆 Creator Points — public creator profile section (balance + history).
// Read-only: the client can never create, edit or delete points.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCreatorPoints, getCreatorPointsHistory } from "@/lib/points.functions";
import { POINTS_EVENT_LABEL, type PointsEventType } from "@/lib/points/points-types";

const PAGE = 10;
const fmt = (n: number) => n.toLocaleString("en-US");

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-base tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function CreatorPointsSection({ address }: { address: string }) {
  const [page, setPage] = useState(0);

  const summaryQ = useQuery({
    queryKey: ["creator-points", address.toLowerCase()],
    queryFn: () => getCreatorPoints({ data: { address } }),
    staleTime: 120_000,
  });

  const historyQ = useQuery({
    queryKey: ["creator-points-history", address.toLowerCase(), page],
    queryFn: () => getCreatorPointsHistory({ data: { address, limit: PAGE, offset: page * PAGE } }),
    staleTime: 120_000,
  });

  const s = summaryQ.data?.summary;
  const ready = summaryQ.data?.ready !== false;
  const entries = historyQ.data?.entries ?? [];
  const total = historyQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🏆 Creator Points</h2>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs tabular-nums">
          {s ? fmt(s.totalPoints) : "—"} pts
        </span>
      </div>

      {!ready ? (
        <p className="text-xs text-muted-foreground">
          El ledger de Creator Points todavía no está disponible en la base de datos.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Total Points" value={s ? fmt(s.totalPoints) : "—"} />
            <Metric label="Current Rank" value="Coming soon" hint="Leaderboard en Fase 2E" />
            <Metric label="Points This Season" value={s ? fmt(s.pointsThisMonth) : "—"} hint="Mes en curso" />
            <Metric label="Points Today" value={s ? fmt(s.pointsToday) : "—"} />
          </div>

          <h3 className="mt-4 mb-2 text-xs uppercase tracking-widest text-muted-foreground">Points History</h3>
          {entries.length ? (
            <ol className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
                  <span className="w-24 shrink-0 font-mono text-muted-foreground">
                    {new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block">{POINTS_EVENT_LABEL[e.eventType as PointsEventType] ?? e.eventType}</span>
                    <span className="text-muted-foreground">
                      {e.reason}
                      {e.multiplier !== 1 ? ` · x${e.multiplier}` : ""}
                    </span>
                  </span>
                  {e.tokenAddress ? (
                    <Link
                      to="/token/$address"
                      params={{ address: e.tokenAddress }}
                      className="font-mono text-[11px] text-muted-foreground hover:text-accent"
                    >
                      ${String((e.metadata as { tokenSymbol?: string } | null)?.tokenSymbol ?? "").toUpperCase() ||
                        `${e.tokenAddress.slice(0, 6)}…`}
                    </Link>
                  ) : null}
                  <span className="shrink-0 font-mono tabular-nums text-success">+{fmt(e.points)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              Todavía no hay eventos de Creator Points para esta dirección.
            </p>
          )}

          {total > PAGE && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="mr-1 h-3 w-3" /> Anterior
              </Button>
              <span className="font-mono text-muted-foreground">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Los Creator Points son puntos internos de reputación y contribución. No son BNB, no son un token, no
        tienen valor monetario garantizado y no pueden retirarse ni transferirse.
      </p>
    </div>
  );
}
