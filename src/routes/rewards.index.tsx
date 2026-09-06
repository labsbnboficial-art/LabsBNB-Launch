// 🎁 Public Rewards page (§26).
// Lists reward programs, their requirements, dates and how many creators are
// currently eligible. It NEVER promises tokens, amounts or guaranteed rewards.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/labsbnb/AppShell";
import { getRewardPrograms } from "@/lib/rewards.functions";
import { CRITERION_LABEL, PROGRAM_STATUS_LABEL, type CriterionKey, type RewardRules } from "@/lib/rewards/rewards-types";

export const Route = createFileRoute("/rewards/")({
  head: () => {
    const title = "Creator Rewards & Eligibility — LabsBNB Launchpad";
    const description =
      "Programas de recompensas para creadores en BNB Smart Chain: requisitos, ventanas de evaluación y número de creadores elegibles. Elegibilidad, no distribución.";
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
  component: RewardsPage,
});

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "N/A";

export function RequirementList({ rules }: { rules: RewardRules }) {
  const keys = (Object.keys(rules.criteria) as CriterionKey[]).filter((k) => rules.criteria[k].enabled);
  if (!keys.length) return <p className="text-xs text-muted-foreground">Sin requisitos configurados.</p>;
  return (
    <ul className="grid gap-1 text-[11px] md:grid-cols-2">
      {keys.map((k) => {
        const r = rules.criteria[k];
        return (
          <li key={k} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
            <span className="text-muted-foreground">
              {CRITERION_LABEL[k]} {r.required ? <span className="text-accent">· obligatorio</span> : <span>· suma</span>}
            </span>
            <span className="font-mono tabular-nums">
              {r.minimum == null ? "—" : k === "seasonRank" ? `Top ${r.minimum}` : `≥ ${r.minimum}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RewardsPage() {
  const q = useQuery({ queryKey: ["reward-programs"], queryFn: () => getRewardPrograms(), staleTime: 60_000 });
  const data = q.data;

  return (
    <AppShell>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-10 md:px-6">
        <h1 className="font-display text-2xl font-bold md:text-3xl">🎁 Creator Rewards</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Estos programas definen <strong>criterios de elegibilidad</strong> para futuras recompensas de creadores. Cumplir
          los requisitos no garantiza ninguna recompensa, cantidad ni airdrop: todavía no existe ningún programa de
          distribución.
        </p>

        {q.isLoading ? (
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-white/5" />
        ) : !data?.storageReady ? (
          <p className="mt-6 rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-muted-foreground">
            Los programas de recompensas aún no están disponibles.
          </p>
        ) : !data.programs.length ? (
          <p className="mt-6 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay programas publicados.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {data.programs.map((p) => (
              <Link
                key={p.slug}
                to="/rewards/$slug"
                params={{ slug: p.slug }}
                className="glass block rounded-2xl p-4 transition hover:border-accent/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold">{p.name}</h2>
                    {p.description && <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{p.description}</p>}
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                    {PROGRAM_STATUS_LABEL[p.status]}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                  <Cell label="Inicio" value={fmt(p.startsAt)} />
                  <Cell label="Fin" value={fmt(p.endsAt)} />
                  <Cell label="Temporada" value={p.seasonName ?? "N/A"} />
                  <Cell
                    label="Creadores elegibles"
                    value={p.eligibleCreators == null ? "N/A" : `${p.eligibleCreators}`}
                  />
                </div>

                <div className="mt-3">
                  <RequirementList rules={p.rules} />
                </div>
              </Link>
            ))}
          </div>
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
