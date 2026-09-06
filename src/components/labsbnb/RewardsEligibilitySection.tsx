// 🎁 Bloque de elegibilidad de recompensas dentro de /creator/:address.
// Solo lectura. Muestra, por programa, el estado y el desglose PASS / FAIL / N/A
// de cada criterio. Nunca promete tokens ni cantidades.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getCreatorRewardEligibility } from "@/lib/rewards.functions";
import { ELIGIBILITY_LABEL, type CriterionResult, type EligibilityStatus } from "@/lib/rewards/rewards-types";

const TONE: Record<EligibilityStatus, string> = {
  eligible: "text-success",
  not_eligible: "text-destructive",
  pending: "text-warning",
  excluded: "text-muted-foreground",
};

const ICON: Record<CriterionResult["status"], string> = { pass: "✅", fail: "❌", na: "⚪" };

function Criterion({ c }: { c: CriterionResult }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {ICON[c.status]} {c.label}
          {c.required && <span className="ml-1 text-accent">*</span>}
        </span>
        <span className="font-mono tabular-nums">
          {c.value == null ? "N/A" : c.value} / {c.target ?? "—"}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full brand-gradient" style={{ width: `${Math.round((c.progress ?? 0) * 100)}%` }} />
      </div>
    </div>
  );
}

export function RewardsEligibilitySection({ address }: { address: string }) {
  const q = useQuery({
    queryKey: ["creator-rewards", address.toLowerCase()],
    queryFn: () => getCreatorRewardEligibility({ data: { address } }),
    staleTime: 60_000,
  });

  const d = q.data;

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🎁 Rewards Eligibility</h2>
        <Link to="/rewards" className="text-[11px] text-muted-foreground hover:text-accent">
          Ver programas →
        </Link>
      </div>

      {q.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/5" />
      ) : !d?.storageReady ? (
        <p className="text-xs text-muted-foreground">La elegibilidad aún no está disponible.</p>
      ) : !d.programs.length ? (
        <p className="text-xs text-muted-foreground">Ahora mismo no hay programas de recompensas abiertos.</p>
      ) : (
        <div className="space-y-3">
          {d.programs.map((p) => (
            <div key={p.slug} className="rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to="/rewards/$slug" params={{ slug: p.slug }} className="text-sm hover:text-accent">
                  {p.name}
                  {p.seasonName && <span className="ml-2 text-[10px] text-muted-foreground">{p.seasonName}</span>}
                </Link>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`font-semibold ${TONE[p.evaluation.status]}`}>
                    {ELIGIBILITY_LABEL[p.evaluation.status]}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {p.evaluation.eligibilityScore.toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="mt-2 grid gap-1 md:grid-cols-2">
                {p.evaluation.criteria.map((c) => (
                  <Criterion key={c.key} c={c} />
                ))}
              </div>

              {p.evaluation.status === "pending" && (
                <p className="mt-2 text-[10px] text-warning">
                  Faltan datos on-chain para completar la evaluación. Se revisará automáticamente en la próxima
                  ejecución.
                </p>
              )}
              {p.evaluation.exclusionReasons.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Excluido por: {p.evaluation.exclusionReasons.join(", ")}.
                </p>
              )}
              <p className="mt-2 text-[10px] text-muted-foreground">
                Reglas v{p.ruleVersion} · evaluado {p.snapshotAt ? new Date(p.snapshotAt).toLocaleString() : "N/A"}
              </p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            La elegibilidad no es dinero ni garantiza ninguna recompensa. * = requisito obligatorio.
          </p>
        </div>
      )}
    </div>
  );
}
