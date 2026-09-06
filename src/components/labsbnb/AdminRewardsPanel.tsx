// Admin panel — 🎁 Creator Rewards & Airdrop Eligibility.
// Cada mutación es una server function protegida por sesión admin + CSRF y
// registrada en `admin_audit_log`. Editar reglas SIEMPRE crea una versión nueva;
// los snapshots históricos jamás se recalculan.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createRewardProgram,
  getRewardsOverview,
  runRewardsEvaluation,
  transitionRewardProgram,
  updateRewardRules,
} from "@/lib/rewards.functions";
import {
  CRITERIA_KEYS,
  CRITERION_LABEL,
  PROGRAM_STATUS_LABEL,
  type CriterionKey,
  type RewardProgramStatus,
  type RewardRules,
} from "@/lib/rewards/rewards-types";

const NEXT_ACTIONS: Record<RewardProgramStatus, { to: RewardProgramStatus; label: string }[]> = {
  draft: [
    { to: "scheduled", label: "Programar" },
    { to: "active", label: "Activar" },
    { to: "archived", label: "Archivar" },
  ],
  scheduled: [
    { to: "active", label: "Activar" },
    { to: "draft", label: "Volver a borrador" },
    { to: "archived", label: "Archivar" },
  ],
  active: [{ to: "ended", label: "Finalizar" }],
  ended: [{ to: "archived", label: "Archivar" }],
  archived: [],
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Error inesperado");
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "N/A");

function RulesEditor({
  csrf,
  programId,
  rules,
  disabled,
  onSaved,
}: {
  csrf: string;
  programId: string;
  rules: RewardRules;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RewardRules>(rules);
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () => updateRewardRules({ data: { csrf, id: programId, rules: draft, note: note || null } }),
    onSuccess: (r) => {
      toast.success(`Reglas guardadas como versión v${r.program.ruleVersion}.`);
      setNote("");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const patch = (key: CriterionKey, part: Partial<RewardRules["criteria"][CriterionKey]>) =>
    setDraft((d) => ({ ...d, criteria: { ...d.criteria, [key]: { ...d.criteria[key], ...part } } }));

  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Criterios</div>
      <div className="mt-2 space-y-1">
        {CRITERIA_KEYS.map((k) => {
          const c = draft.criteria[k];
          return (
            <div key={k} className="grid grid-cols-2 items-center gap-2 text-[11px] md:grid-cols-5">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={c.enabled} onChange={(e) => patch(k, { enabled: e.target.checked })} />
                {CRITERION_LABEL[k]}
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Mín.</span>
                <input
                  type="number"
                  min={0}
                  value={c.minimum ?? 0}
                  onChange={(e) => patch(k, { minimum: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Peso</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={c.weight}
                  onChange={(e) => patch(k, { weight: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={c.required} onChange={(e) => patch(k, { required: e.target.checked })} />
                Obligatorio
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">Exclusiones</div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
        {(
          [
            ["selfTradeDetected", "Self-trading"],
            ["circularActivity", "Actividad circular"],
            ["nonOrganicActivity", "Actividad no orgánica"],
            ["requireSeasonParticipation", "Exigir participar en la temporada"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(draft.exclusions[key])}
              onChange={(e) => setDraft((d) => ({ ...d, exclusions: { ...d.exclusions, [key]: e.target.checked } }))}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Motivo del cambio (auditoría)"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px]"
        />
        <button
          type="button"
          disabled={disabled || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-[11px] disabled:opacity-40"
        >
          {save.isPending ? "Guardando…" : "Guardar nueva versión"}
        </button>
      </div>
      {disabled && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Un programa finalizado o archivado es inmutable: sus reglas no se pueden cambiar.
        </p>
      )}
    </div>
  );
}

export function AdminRewardsPanel({ csrf }: { csrf: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [openRules, setOpenRules] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["admin-rewards", csrf],
    queryFn: () => getRewardsOverview({ data: { csrf } }),
    staleTime: 15_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-rewards"] });

  const run = useMutation({
    mutationFn: (v: { dryRun: boolean; backfill: boolean }) =>
      runRewardsEvaluation({ data: { csrf, dryRun: v.dryRun, backfill: v.backfill, programId: null } }),
    onSuccess: (r) => {
      if (r.skipped) toast.warning(r.skippedReason ?? "Ejecución omitida.");
      else
        toast.success(
          `Elegibilidad: ${r.state.creatorsEvaluated} creadores · ${r.state.eligible} elegibles · ${r.state.snapshotsCreated} snapshots`,
        );
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const create = useMutation({
    mutationFn: () =>
      createRewardProgram({
        data: {
          csrf,
          name,
          description: description || null,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          seasonId: seasonId || null,
          evaluationWindow: seasonId ? "season" : "current",
          evaluationStart: null,
          evaluationEnd: null,
        },
      }),
    onSuccess: () => {
      toast.success("Programa creado en borrador.");
      setName("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setSeasonId("");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const transition = useMutation({
    mutationFn: (v: { id: string; to: RewardProgramStatus }) =>
      transitionRewardProgram({ data: { csrf, id: v.id, to: v.to } }),
    onSuccess: () => {
      toast.success("Estado actualizado.");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const d = overview.data;

  return (
    <section className="glass mt-6 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🎁 Rewards & Eligibility</h2>
        <div className="flex gap-2 text-[11px]">
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate({ dryRun: true, backfill: false })}
            className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
          >
            Simular (dry-run)
          </button>
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate({ dryRun: false, backfill: false })}
            className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 disabled:opacity-40"
          >
            {run.isPending ? "Evaluando…" : "Evaluar ahora"}
          </button>
        </div>
      </div>

      {d && !d.storageReady && (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          Faltan las tablas de recompensas: aplica <code>docs/SQL_CREATOR_REWARDS_ELIGIBILITY.md</code>.
          {d.storageError ? ` (${d.storageError})` : ""}
        </p>
      )}

      {d && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
          <Cell label="Última ejecución" value={fmt(d.state.lastSuccessAt)} />
          <Cell label="Creadores evaluados" value={String(d.state.creatorsEvaluated)} />
          <Cell label="Elegibles" value={String(d.state.eligible)} />
          <Cell label="Snapshots" value={String(d.state.snapshotsCreated)} />
        </div>
      )}

      <div className="mt-4 rounded-xl border border-white/10 p-3">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Nuevo programa</div>
        <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del programa"
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción pública"
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          />
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Inicio</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Fin</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
            />
          </label>
          <select
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
            aria-label="Temporada asociada"
          >
            <option value="">Ventana actual (sin temporada)</option>
            {d?.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={create.isPending || name.trim().length < 3}
            onClick={() => create.mutate()}
            className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 disabled:opacity-40"
          >
            {create.isPending ? "Creando…" : "Crear programa"}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {overview.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        ) : !d?.programs.length ? (
          <p className="text-[11px] text-muted-foreground">Todavía no hay programas creados.</p>
        ) : (
          d.programs.map(({ program, stats, versions }) => (
            <div key={program.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm">{program.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    /{program.slug} · v{program.ruleVersion} · {versions.length} versiones
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 uppercase tracking-widest">
                    {PROGRAM_STATUS_LABEL[program.status]}
                  </span>
                  {NEXT_ACTIONS[program.status].map((a) => (
                    <button
                      key={a.to}
                      type="button"
                      disabled={transition.isPending}
                      onClick={() => transition.mutate({ id: program.id, to: a.to })}
                      className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                    >
                      {a.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOpenRules((v) => (v === program.id ? null : program.id))}
                    className="rounded-full border border-white/10 px-3 py-1"
                  >
                    Reglas
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                <Cell label="Evaluados" value={stats.evaluated == null ? "N/A" : String(stats.evaluated)} />
                <Cell label="Elegibles" value={stats.eligible == null ? "N/A" : String(stats.eligible)} />
                <Cell label="Última evaluación" value={fmt(stats.lastEvaluatedAt)} />
                <Cell label="Fin" value={fmt(program.endsAt)} />
              </div>

              {openRules === program.id && (
                <RulesEditor
                  csrf={csrf}
                  programId={program.id}
                  rules={program.rules}
                  disabled={program.status === "ended" || program.status === "archived"}
                  onSaved={refresh}
                />
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}
