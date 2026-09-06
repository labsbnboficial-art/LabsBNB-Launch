// 🎁 Public detail of one reward program: requisitos, estadísticas y la tabla
// pública de elegibilidad. Solo lectura: nada aquí distribuye tokens.
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { getRewardEligibility, getRewardProgram } from "@/lib/rewards.functions";
import { RequirementList } from "@/routes/rewards.index";
import {
  ELIGIBILITY_LABEL,
  PROGRAM_STATUS_LABEL,
  type EligibilityStatus,
} from "@/lib/rewards/rewards-types";

export const Route = createFileRoute("/rewards/$slug")({
  head: ({ params }) => {
    const title = `Programa ${params.slug} — Creator Rewards | LabsBNB Launchpad`;
    const description = `Requisitos de elegibilidad, ventana de evaluación y creadores elegibles del programa ${params.slug} en BNB Smart Chain.`;
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
  component: ProgramPage,
});

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "N/A");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const STATUS_TONE: Record<EligibilityStatus, string> = {
  eligible: "text-success",
  not_eligible: "text-destructive",
  pending: "text-warning",
  excluded: "text-muted-foreground",
};

type Tab = "eligibility" | "stats" | "rules";
const FILTERS: (EligibilityStatus | "all")[] = ["all", "eligible", "pending", "not_eligible", "excluded"];

function ProgramPage() {
  const { slug } = Route.useParams();
  const [tab, setTab] = useState<Tab>("eligibility");
  const [filter, setFilter] = useState<EligibilityStatus | "all">("all");
  const [page, setPage] = useState(1);

  const programQ = useQuery({
    queryKey: ["reward-program", slug],
    queryFn: () => getRewardProgram({ data: { slug } }),
    staleTime: 60_000,
  });
  const eligibilityQ = useQuery({
    queryKey: ["reward-eligibility", slug, filter, page],
    queryFn: () => getRewardEligibility({ data: { slug, filter, page, pageSize: 25 } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const program = programQ.data?.program ?? null;
  const table = eligibilityQ.data;
  const pages = table ? Math.max(1, Math.ceil(table.total / table.pageSize)) : 1;

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <Link to="/rewards" className="text-[11px] text-muted-foreground hover:text-accent">
          ← Todos los programas
        </Link>

        {programQ.isLoading ? (
          <div className="mt-4 h-32 animate-pulse rounded-2xl bg-white/5" />
        ) : !program ? (
          <p className="mt-6 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
            Este programa no existe o todavía no es público.
          </p>
        ) : (
          <>
            <div className="glass mt-3 rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="font-display text-xl font-bold md:text-2xl">🎁 {program.name}</h1>
                  {program.description && (
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{program.description}</p>
                  )}
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                  {PROGRAM_STATUS_LABEL[program.status]}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                <Cell label="Inicio" value={fmt(program.startsAt)} />
                <Cell label="Fin" value={fmt(program.endsAt)} />
                <Cell label="Temporada" value={program.seasonName ?? "N/A"} />
                <Cell label="Versión de reglas" value={`v${program.ruleVersion}`} />
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Cumplir los requisitos indica elegibilidad, no una recompensa garantizada. Ninguna cantidad, token ni
                fecha de distribución está comprometida.
              </p>
            </div>

            <div className="mt-4 flex gap-2 text-xs">
              {(["eligibility", "stats", "rules"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-full border px-3 py-1 ${
                    tab === t ? "border-accent/60 bg-accent/10" : "border-white/10 bg-white/5 text-muted-foreground"
                  }`}
                >
                  {t === "eligibility" ? "Elegibilidad" : t === "stats" ? "Estadísticas" : "Reglas"}
                </button>
              ))}
            </div>

            {tab === "rules" && (
              <div className="glass mt-4 rounded-2xl p-4">
                <h2 className="mb-3 font-display text-sm font-semibold">📋 Requisitos</h2>
                <RequirementList rules={program.rules} />
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Los criterios marcados como obligatorios deben cumplirse todos. Los demás solo suman progreso. Si un
                  dato no está disponible se muestra N/A y el creador queda en revisión, nunca como no elegible.
                </p>
              </div>
            )}

            {tab === "stats" && (
              <div className="glass mt-4 grid grid-cols-2 gap-2 rounded-2xl p-4 md:grid-cols-4">
                <Cell label="Creadores evaluados" value={program.evaluatedCreators?.toString() ?? "N/A"} />
                <Cell label="Elegibles" value={program.eligibleCreators?.toString() ?? "N/A"} />
                <Cell label="Última evaluación" value={fmt(program.lastEvaluatedAt)} />
                <Cell label="Ventana" value={program.evaluationWindow} />
                {table && (
                  <>
                    <Cell label="En revisión" value={String(table.counts.pending)} />
                    <Cell label="No elegibles" value={String(table.counts.not_eligible)} />
                    <Cell label="Excluidos" value={String(table.counts.excluded)} />
                    <Cell label="Total" value={String(table.total)} />
                  </>
                )}
              </div>
            )}

            {tab === "eligibility" && (
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFilter(f);
                        setPage(1);
                      }}
                      className={`rounded-full border px-3 py-1 ${
                        filter === f ? "border-accent/60 bg-accent/10" : "border-white/10 bg-white/5 text-muted-foreground"
                      }`}
                    >
                      {f === "all" ? "Todos" : ELIGIBILITY_LABEL[f]}
                      {table ? ` (${f === "all" ? table.total : table.counts[f]})` : ""}
                    </button>
                  ))}
                </div>

                {eligibilityQ.isLoading && !table ? (
                  <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
                ) : !table?.entries.length ? (
                  <p className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                    Todavía no hay evaluaciones publicadas para este filtro.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {table.entries.map((e) => (
                      <Link
                        key={e.address}
                        to="/creator/$address"
                        params={{ address: e.address }}
                        className="glass flex flex-wrap items-center gap-3 rounded-xl p-3 text-xs transition hover:border-accent/40"
                      >
                        <span className="w-8 font-mono text-muted-foreground">#{e.rank}</span>
                        <span className="min-w-0 flex-1 truncate">{e.displayName ?? short(e.address)}</span>
                        <span className={`font-semibold ${STATUS_TONE[e.status]}`}>{ELIGIBILITY_LABEL[e.status]}</span>
                        <span className="font-mono tabular-nums">{e.eligibilityScore.toFixed(0)}%</span>
                        <span className="hidden font-mono tabular-nums text-muted-foreground md:inline">
                          {e.metrics.points == null ? "N/A" : `${e.metrics.points} pts`}
                        </span>
                      </Link>
                    ))}

                    <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                      >
                        ← Anterior
                      </button>
                      <span>
                        Página {table.page} de {pages}
                      </span>
                      <button
                        type="button"
                        disabled={page >= pages}
                        onClick={() => setPage((p) => p + 1)}
                        className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                      >
                        Siguiente →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}
