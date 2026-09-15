// Admin — 🎁 Reward Allocation (Fase 2G), dentro de Rewards & Eligibility.
// Configuración versionada + Preview (dry-run) + Evaluate. Nada de esto
// transfiere tokens ni dinero: los importes son cálculo interno del programa.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAllocationOverview, runAllocation, updateAllocationConfig } from "@/lib/allocation.functions";
import {
  ALLOCATION_FACTOR_KEYS,
  ALLOCATION_FACTOR_LABEL,
  ALLOCATION_METHODS,
  ALLOCATION_METHOD_LABEL,
  ALLOCATION_STATUS_LABEL,
  ALLOCATION_VISIBILITIES,
  type AllocationConfig,
  type AllocationFactorKey,
  type AllocationStatus,
  type AllocationVisibility,
} from "@/lib/rewards/allocation-types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Error inesperado");
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "N/A");
const pct = (v: number | null) => (v == null ? "N/A" : `${v.toFixed(2)} %`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const VISIBILITY_LABEL: Record<AllocationVisibility, string> = {
  hidden: "Oculta",
  weights: "Solo pesos / %",
  amounts: "Pesos + importes",
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function AdminAllocationPanel({ csrf, programId, programName }: { csrf: string; programId: string; programName: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AllocationConfig | null>(null);
  const [note, setNote] = useState("");

  const overview = useQuery({
    queryKey: ["admin-allocation", programId],
    queryFn: () => getAllocationOverview({ data: { csrf, programId } }),
    staleTime: 15_000,
  });
  const d = overview.data;

  useEffect(() => {
    if (d?.config && !draft) setDraft(d.config);
  }, [d, draft]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-allocation", programId] });

  const save = useMutation({
    mutationFn: () => updateAllocationConfig({ data: { csrf, programId, config: draft, note: note || null } }),
    onSuccess: (r) => {
      toast.success(`Configuración de Allocation guardada como v${r.version}.`);
      setNote("");
      setDraft(r.config);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const run = useMutation({
    mutationFn: (dryRun: boolean) => runAllocation({ data: { csrf, dryRun, programId } }),
    onSuccess: (r) => {
      if (r.skipped) toast.warning(r.skippedReason ?? "Ejecución omitida.");
      else if (r.state.errors > 0) toast.error(r.state.lastError ?? "La allocation terminó con errores.");
      else
        toast.success(
          `${r.dryRun ? "Dry run" : "Allocation"}: ${r.state.eligible} elegibles · ${r.state.recipients} con asignación · ${r.state.totalPct.toFixed(2)} % · ${r.state.snapshotsCreated} snapshots · ${r.state.duplicates} duplicados evitados`,
        );
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!draft) return <div className="mt-3 h-24 animate-pulse rounded-xl bg-white/5" />;

  const patchFactor = (key: AllocationFactorKey, part: Partial<AllocationConfig["factors"][AllocationFactorKey]>) =>
    setDraft((c) => (c ? { ...c, factors: { ...c.factors, [key]: { ...c.factors[key], ...part } } } : c));
  const patch = (part: Partial<AllocationConfig>) => setDraft((c) => (c ? { ...c, ...part } : c));

  const preview = d?.preview ?? null;

  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Allocation · {programName} · v{d?.version ?? 1}
        </div>
        <div className="flex gap-2 text-[11px]">
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate(true)}
            className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
          >
            Preview (dry-run)
          </button>
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate(false)}
            className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 disabled:opacity-40"
          >
            {run.isPending ? "Calculando…" : "Evaluate"}
          </button>
        </div>
      </div>

      {d && !d.storageReady && (
        <p className="mt-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          Falta la tabla de allocation: aplica <code>docs/SQL_CREATOR_REWARD_ALLOCATION.md</code>.
          {d.storageError ? ` (${d.storageError})` : ""}
        </p>
      )}

      <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          Allocation activa
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Método</span>
          <select
            value={draft.method}
            onChange={(e) => patch({ method: e.target.value as AllocationConfig["method"] })}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          >
            {ALLOCATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {ALLOCATION_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Visibilidad pública</span>
          <select
            value={draft.visibility}
            onChange={(e) => patch({ visibility: e.target.value as AllocationVisibility })}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          >
            {ALLOCATION_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {draft.method === "weighted" && (
        <div className="mt-3 space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Factores</div>
          {ALLOCATION_FACTOR_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-2 items-center gap-2 text-[11px] md:grid-cols-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.factors[k].enabled}
                  onChange={(e) => patchFactor(k, { enabled: e.target.checked })}
                />
                {ALLOCATION_FACTOR_LABEL[k]}
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Peso</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.factors[k].weight}
                  onChange={(e) => patchFactor(k, { weight: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono"
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-4">
        <NumField
          label="Eligibility Score mínimo"
          value={draft.minEligibilityScore}
          onChange={(v) => patch({ minEligibilityScore: v })}
        />
        <NumField label="Cap por creador (%)" value={draft.maxSharePct} onChange={(v) => patch({ maxSharePct: v })} />
        <NumField label="Floor por creador (%)" value={draft.minSharePct} onChange={(v) => patch({ minSharePct: v })} />
        <NumField label="Máx. destinatarios" value={draft.maxRecipients} onChange={(v) => patch({ maxRecipients: v })} />
      </div>

      <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.pool.enabled}
            onChange={(e) => patch({ pool: { ...draft.pool, enabled: e.target.checked } })}
          />
          Reward pool configurado
        </label>
        <NumField
          label="Total del pool"
          value={draft.pool.total}
          onChange={(v) => patch({ pool: { ...draft.pool, total: v } })}
        />
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Unidad</span>
          <input
            value={draft.pool.unit ?? ""}
            onChange={(e) => patch({ pool: { ...draft.pool, unit: e.target.value || null } })}
            placeholder="p. ej. puntos"
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Sin reward pool no se calcula ningún importe y la web pública nunca muestra cantidades. Un importe aquí es un
        cálculo interno del programa: no compromete ninguna distribución.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Motivo del cambio (auditoría)"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px]"
        />
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-[11px] disabled:opacity-40"
        >
          {save.isPending ? "Guardando…" : "Guardar nueva versión"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
        <Cell label="Base de elegibilidad" value={fmt(d?.eligibilityEvaluatedAt)} />
        <Cell label="Creadores en la base" value={String(d?.eligibilityCreators ?? 0)} />
        <Cell label="Elegibles" value={String(preview?.totals.eligible ?? 0)} />
        <Cell label="Con asignación" value={String(preview?.totals.recipients ?? 0)} />
        <Cell label="Allocation total" value={preview ? `${preview.totals.totalPct.toFixed(2)} %` : "N/A"} />
        <Cell
          label="Importe total"
          value={preview?.totals.totalAmount == null ? "N/A" : `${preview.totals.totalAmount} ${preview.totals.poolUnit ?? ""}`}
        />
        <Cell label="Pending data" value={String(preview?.totals.pendingData ?? 0)} />
        <Cell label="Sin asignar" value={preview ? `${preview.totals.unallocatedPct.toFixed(2)} %` : "N/A"} />
        <Cell label="Snapshots (último run)" value={String(d?.state.snapshotsCreated ?? 0)} />
        <Cell label="Duplicados evitados" value={String(d?.state.duplicates ?? 0)} />
        <Cell label="Errores" value={String(d?.state.errors ?? 0)} />
        <Cell label="Último snapshot" value={fmt(d?.storedEvaluatedAt)} />
      </div>

      {d && d.state.errors > 0 && (
        <p className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          ALLOCATION_ERROR · {d.state.lastError ?? "sin detalle"}
        </p>
      )}
      {preview && preview.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-muted-foreground">
          {preview.warnings.slice(0, 8).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {preview && preview.results.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Preview por creador</div>
          {preview.results.slice(0, 25).map((r) => (
            <div key={r.address} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px]">
              <span className="font-mono">{short(r.address)}</span>
              <span className="flex-1">{ALLOCATION_STATUS_LABEL[r.status as AllocationStatus]}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                score {r.allocationScore == null ? "N/A" : r.allocationScore.toFixed(2)}
              </span>
              <span className="font-mono tabular-nums">peso {r.normalizedWeight == null ? "N/A" : r.normalizedWeight.toFixed(4)}</span>
              <span className="font-mono tabular-nums">{pct(r.allocationPct)}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {r.allocationAmount == null ? "N/A" : `${r.allocationAmount} ${preview.totals.poolUnit ?? ""}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        placeholder="N/A"
        onChange={(e) => onChange(numOrNull(e.target.value))}
        className="w-24 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono"
      />
    </label>
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
