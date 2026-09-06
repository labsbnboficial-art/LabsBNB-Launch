// Admin panel — 🏆 Leaderboard Engine + 🗓️ Creator Seasons.
// Every mutation is a server function protected by admin session + CSRF and
// recorded in `admin_audit_log`. Ranks, points and scores are never editable.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createSeason,
  createSeasonSnapshot,
  getLeaderboardOverview,
  runLeaderboard,
  transitionSeason,
  updateSeasonDraft,
} from "@/lib/leaderboard.functions";
import type { SeasonStatus } from "@/lib/leaderboard/leaderboard-types";

const STATUS_LABEL: Record<SeasonStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  active: "Activa",
  ended: "Finalizada",
  archived: "Archivada",
};

const NEXT_ACTIONS: Record<SeasonStatus, { to: SeasonStatus; label: string }[]> = {
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
  active: [{ to: "ended", label: "Finalizar (snapshot final)" }],
  ended: [{ to: "archived", label: "Archivar" }],
  archived: [],
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Error inesperado");
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "N/A");
const toIsoLocal = (iso: string) => new Date(iso).toISOString().slice(0, 16);

export function AdminLeaderboardPanel({ csrf }: { csrf: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const overview = useQuery({
    queryKey: ["admin-leaderboard", csrf],
    queryFn: () => getLeaderboardOverview({ data: { csrf } }),
    staleTime: 15_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-leaderboard"] });

  const run = useMutation({
    mutationFn: (v: { dryRun: boolean; backfill: boolean }) =>
      runLeaderboard({ data: { csrf, dryRun: v.dryRun, backfill: v.backfill } }),
    onSuccess: (r) => {
      if (r.skipped) toast.warning(r.skippedReason ?? "Ejecución omitida.");
      else
        toast.success(
          `Leaderboard: ${r.state.creatorsEvaluated} creadores · ${r.state.snapshotsCreated} snapshots · ${r.state.errors} errores`,
        );
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const create = useMutation({
    mutationFn: () =>
      createSeason({
        data: {
          csrf,
          name,
          description: description.trim() ? description.trim() : null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Temporada "${r.season.name}" creada como borrador.`);
      setName("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const update = useMutation({
    mutationFn: (v: { id: string }) =>
      updateSeasonDraft({
        data: { csrf, id: v.id, startsAt: new Date(editStart).toISOString(), endsAt: new Date(editEnd).toISOString() },
      }),
    onSuccess: () => {
      toast.success("Fechas actualizadas.");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const move = useMutation({
    mutationFn: (v: { id: string; to: SeasonStatus }) => transitionSeason({ data: { csrf, id: v.id, to: v.to } }),
    onSuccess: (r) => {
      toast.success(`Temporada "${r.season.name}" → ${STATUS_LABEL[r.season.status]}`);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const snapshot = useMutation({
    mutationFn: (v: { id: string }) => createSeasonSnapshot({ data: { csrf, id: v.id } }),
    onSuccess: (r) => toast.success(`Snapshot final: ${r.participants} participantes · ${r.inserted} filas nuevas.`),
    onError: (e) => toast.error(errMsg(e)),
  });

  const data = overview.data;
  const state = data?.state;
  const busy = run.isPending || create.isPending || move.isPending || snapshot.isPending || update.isPending;

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold">🏆 Creator Leaderboard & Seasons</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run.mutate({ dryRun: true, backfill: false })}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs disabled:opacity-40"
          >
            Preview (dry-run)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run.mutate({ dryRun: false, backfill: false })}
            className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-xs text-accent disabled:opacity-40"
          >
            Snapshot ahora
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run.mutate({ dryRun: false, backfill: true })}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs disabled:opacity-40"
          >
            Backfill inicial
          </button>
        </div>
      </div>

      {data && !data.storageReady && (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          Faltan las tablas del leaderboard. Ejecuta <code>docs/SQL_CREATOR_LEADERBOARD.md</code> en Supabase.
          {data.storageError ? ` (${data.storageError})` : ""}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Última ejecución" value={fmt(state?.finishedAt ?? null)} />
        <Metric label="Creadores evaluados" value={String(state?.creatorsEvaluated ?? 0)} />
        <Metric label="Snapshots" value={String(state?.snapshotsCreated ?? 0)} />
        <Metric label="Snapshots temporada" value={String(state?.seasonSnapshotsCreated ?? 0)} />
        <Metric label="Duplicados evitados" value={String(state?.duplicates ?? 0)} />
        <Metric label="Errores" value={String(state?.errors ?? 0)} />
        <Metric label="Duración" value={state ? `${state.durationMs} ms` : "N/A"} />
        <Metric label="Último éxito" value={fmt(state?.lastSuccessAt ?? null)} />
      </div>

      {state?.lastError && <p className="mt-2 text-[11px] text-destructive">Último error: {state.lastError}</p>}
      {state?.notes?.length ? (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {state.notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      ) : null}

      {/* -------------------------------- seasons ------------------------------ */}
      <h4 className="mt-6 font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        🗓️ Temporadas
      </h4>

      <div className="mt-3 space-y-2">
        {(data?.seasons ?? []).map((s) => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{s.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {new Date(s.startsAt).toLocaleString()} → {new Date(s.endsAt).toLocaleString()} · {s.participants}{" "}
                  participantes
                </div>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest">
                {STATUS_LABEL[s.status]}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {NEXT_ACTIONS[s.status].map((a) => (
                <button
                  key={a.to}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (a.to === "ended" && !confirm("Finalizar la temporada crea un ranking FINAL inmutable. ¿Continuar?"))
                      return;
                    move.mutate({ id: s.id, to: a.to });
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  {a.label}
                </button>
              ))}
              {(s.status === "active" || s.status === "ended") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => snapshot.mutate({ id: s.id })}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Snapshot final
                </button>
              )}
              {(s.status === "draft" || s.status === "scheduled") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(editing === s.id ? null : s.id);
                    setEditStart(toIsoLocal(s.startsAt));
                    setEditEnd(toIsoLocal(s.endsAt));
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Editar fechas
                </button>
              )}
            </div>
            {editing === s.id && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Inicio" value={editStart} onChange={setEditStart} type="datetime-local" />
                <Field label="Fin" value={editEnd} onChange={setEditEnd} type="datetime-local" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => update.mutate({ id: s.id })}
                  className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-accent disabled:opacity-40"
                >
                  Guardar
                </button>
              </div>
            )}
          </div>
        ))}
        {!data?.seasons?.length && <p className="text-[11px] text-muted-foreground">Todavía no hay temporadas.</p>}
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Nueva temporada</div>
        <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
          <Field label="Nombre" value={name} onChange={setName} placeholder="Season 1" />
          <Field label="Inicio" value={startsAt} onChange={setStartsAt} type="datetime-local" />
          <Field label="Fin" value={endsAt} onChange={setEndsAt} type="datetime-local" />
          <Field label="Descripción" value={description} onChange={setDescription} placeholder="Opcional" />
          <button
            type="button"
            disabled={busy || !name.trim() || !startsAt || !endsAt}
            onClick={() => create.mutate()}
            className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-accent disabled:opacity-40"
          >
            Crear borrador
          </button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Solo puede haber una temporada activa a la vez. Al finalizarla se guarda un ranking final inmutable; el
          ledger de Creator Points nunca se modifica ni se duplica.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs"
      />
    </label>
  );
}
