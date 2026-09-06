// Admin → 🏆 Creator Points.
// Status, observability, per-event configuration, dry-run preview and execute.
// The ledger is append-only: this panel can NEVER edit or delete history.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Eye, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getPointsOverview, runPointsEngine, savePointsConfig } from "@/lib/points.functions";
import { AdminLevelsPanel } from "@/components/labsbnb/AdminLevelsPanel";
import { AdminLevelHistoryPanel } from "@/components/labsbnb/AdminLevelHistoryPanel";
import {
  DEFAULT_POINTS_CONFIG,
  POINTS_EVENT_LABEL,
  POINTS_EVENT_TYPES,
  type CreatorPointsConfig,
  type PointsCandidate,
  type PointsEventType,
  type PointsExclusion,
} from "@/lib/points/points-types";

const fmt = (n: number) => n.toLocaleString("en-US");

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold">{value}</p>
    </div>
  );
}

export function AdminPointsTab({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getPointsOverview);
  const saveFn = useServerFn(savePointsConfig);
  const runFn = useServerFn(runPointsEngine);

  const q = useQuery({ queryKey: ["admin-points"], queryFn: () => overviewFn({ data: { csrf } }) });

  const [cfg, setCfg] = useState<CreatorPointsConfig>(DEFAULT_POINTS_CONFIG);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preview, setPreview] = useState<{
    dryRun: boolean;
    points: number;
    candidates: PointsCandidate[];
    exclusions: PointsExclusion[];
    duplicates: number;
    tokens: number;
  } | null>(null);

  useEffect(() => {
    if (q.data?.config) setCfg(q.data.config);
  }, [q.data?.config]);

  const state = q.data?.state;

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveFn({ data: { csrf, config: cfg } });
      setCfg(res.config);
      toast.success("Configuración de Creator Points guardada.");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "run");
    try {
      const res = await runFn({
        data: { csrf, dryRun, startDate: startDate || null, endDate: endDate || null },
      });
      if (res.skipped === "disabled") toast.warning("El motor está desactivado.");
      else if (res.skipped === "locked") toast.warning("Ya hay una ejecución en curso.");
      else if (res.skipped === "storage") toast.error("Falta ejecutar docs/SQL_CREATOR_POINTS.md.");
      else if (dryRun) toast.success(`Preview: ${res.state.eventsEligible} eventos · ${fmt(res.state.pointsAwarded)} puntos.`);
      else toast.success(`Ejecutado: ${fmt(res.state.pointsAwarded)} puntos otorgados.`);
      setPreview({
        dryRun,
        points: res.state.pointsAwarded,
        candidates: res.preview,
        exclusions: res.exclusions,
        duplicates: res.state.duplicatesSkipped,
        tokens: res.state.tokensScanned,
      });
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar.");
    } finally {
      setBusy(null);
    }
  };

  const setEvent = (key: PointsEventType, patch: Partial<CreatorPointsConfig["events"][PointsEventType]>) =>
    setCfg((c) => ({ ...c, events: { ...c.events, [key]: { ...c.events[key], ...patch } } }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">🏆 Creator Points Engine</h2>
          <p className="text-xs text-muted-foreground">
            Creator Points: {cfg.engine_enabled ? "ENABLED" : "DISABLED"} · Chain: BNB Mainnet ({q.data?.chainId ?? 56})
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={busy != null}>
            {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Preview Points
          </Button>
          <Button size="sm" onClick={() => run(false)} disabled={busy != null}>
            {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Execute
          </Button>
        </div>
      </div>

      {q.data && !q.data.storageReady && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
          <span>
            El ledger <code>creator_points_ledger</code> no existe todavía. Ejecuta{" "}
            <code>docs/SQL_CREATOR_POINTS.md</code> en la base de datos. El preview (dry-run) funciona igualmente.
            {q.data.storageError ? ` Detalle: ${q.data.storageError}` : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <Stat label="Last run" value={state?.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : "—"} />
        <Stat label="Duration" value={state ? `${state.durationMs} ms` : "—"} />
        <Stat label="Events processed" value={state?.eventsScanned ?? 0} />
        <Stat label="Points awarded" value={fmt(state?.pointsAwarded ?? 0)} />
        <Stat label="Duplicates" value={state?.duplicatesSkipped ?? 0} />
        <Stat label="Excluded" value={state?.antiFarmingExcluded ?? 0} />
        <Stat label="Errors" value={state?.errors ?? 0} />
        <Stat label="Creators" value={state?.creatorsScanned ?? 0} />
        <Stat label="Tokens" value={state?.tokensScanned ?? 0} />
        <Stat label="Interval" value={`${cfg.scan_interval_min} min`} />
      </div>

      {state?.lastError && <p className="text-xs text-destructive">Último error: {state.lastError}</p>}

      {/* --------------------------- global settings --------------------------- */}
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Motor activo</Label>
            <p className="text-xs text-muted-foreground">Cuando está apagado, el cron no otorga puntos.</p>
          </div>
          <Switch
            checked={cfg.engine_enabled}
            onCheckedChange={(v) => setCfg((c) => ({ ...c, engine_enabled: v }))}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {(
            [
              ["scan_interval_min", "Intervalo (min)"],
              ["max_token_creations_per_day", "Tokens premiados / día"],
              ["lookback_days", "Días de historial escaneados"],
              ["community_min_holders", "Community: holders mínimos"],
              ["community_min_buyers", "Community: compradores mínimos"],
            ] as [keyof CreatorPointsConfig, string][]
          ).map(([key, label]) => (
            <div key={String(key)}>
              <Label className="text-xs">{label}</Label>
              <Input
                type="number"
                value={String(cfg[key] as number)}
                onChange={(e) => setCfg((c) => ({ ...c, [key]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(
            [
              ["buyer_milestones", "Milestones de compradores únicos"],
              ["holder_milestones", "Milestones de holders"],
              ["volume_milestones", "Milestones de volumen orgánico (BNB)"],
              ["milestone_points", "Puntos por milestone"],
            ] as [keyof CreatorPointsConfig, string][]
          ).map(([key, label]) => (
            <div key={String(key)}>
              <Label className="text-xs">{label}</Label>
              <Input
                value={(cfg[key] as number[]).join(", ")}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    [key]: e.target.value.split(",").map((v) => Number(v.trim())),
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------- event configuration ------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="p-3">Event</th>
              <th className="p-3">Enabled</th>
              <th className="p-3">Points</th>
              <th className="p-3">Multiplier</th>
              <th className="p-3">Daily cap</th>
              <th className="p-3">One-time</th>
              <th className="p-3">Min. activity</th>
            </tr>
          </thead>
          <tbody>
            {POINTS_EVENT_TYPES.map((key) => {
              const e = cfg.events[key];
              const milestone = key.endsWith("_MILESTONE") && key !== "COMMUNITY_MILESTONE";
              return (
                <tr key={key} className="border-t border-white/5">
                  <td className="p-3">{POINTS_EVENT_LABEL[key]}</td>
                  <td className="p-3">
                    <Switch checked={e.enabled} onCheckedChange={(v) => setEvent(key, { enabled: v })} />
                  </td>
                  <td className="p-3">
                    {milestone ? (
                      <span className="text-muted-foreground">por milestone</span>
                    ) : (
                      <Input
                        className="h-8 w-24"
                        type="number"
                        value={String(e.base_points)}
                        onChange={(ev) => setEvent(key, { base_points: Number(ev.target.value) })}
                      />
                    )}
                  </td>
                  <td className="p-3">
                    <Switch
                      checked={e.apply_multiplier}
                      onCheckedChange={(v) => setEvent(key, { apply_multiplier: v })}
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      className="h-8 w-24"
                      type="number"
                      value={String(e.daily_cap)}
                      onChange={(ev) => setEvent(key, { daily_cap: Number(ev.target.value) })}
                    />
                  </td>
                  <td className="p-3">
                    <Switch checked={e.one_time} onCheckedChange={(v) => setEvent(key, { one_time: v })} />
                  </td>
                  <td className="p-3">
                    <Input
                      className="h-8 w-20"
                      type="number"
                      value={String(e.minimum_activity)}
                      onChange={(ev) => setEvent(key, { minimum_activity: Number(ev.target.value) })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Backfill desde</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Backfill hasta</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar configuración
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Los cambios de puntos NO son retroactivos: el historial del ledger nunca se recalcula.
        </p>
      </div>

      {/* ------------------------------- preview -------------------------------- */}
      {preview && (
        <div className="rounded-2xl border border-white/10 p-4">
          <h3 className="font-display text-sm font-semibold">
            {preview.dryRun ? "Dry run — nada fue escrito" : "Ejecución aplicada al ledger"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Tokens scanned: {preview.tokens} · Potential events: {preview.candidates.length} · Points:{" "}
            {fmt(preview.points)} · Excluded: {preview.exclusions.length} · Duplicates: {preview.duplicates}
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <ul className="space-y-1 text-xs">
              {preview.candidates.slice(0, 12).map((c) => (
                <li key={c.fingerprint} className="flex justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2">
                  <span className="truncate">
                    {POINTS_EVENT_LABEL[c.eventType]} ·{" "}
                    <span className="font-mono text-muted-foreground">
                      {String((c.metadata as { tokenSymbol?: string }).tokenSymbol ?? "")}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-success">+{fmt(c.points)}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-xs">
              {preview.exclusions.slice(0, 12).map((x, i) => (
                <li key={`${x.eventType}-${i}`} className="rounded-lg bg-white/[0.02] px-3 py-2 text-muted-foreground">
                  {POINTS_EVENT_LABEL[x.eventType]} — {x.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ----------------------------- recent ledger ---------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="p-3">Creator</th>
              <th className="p-3">Event</th>
              <th className="p-3">Token</th>
              <th className="p-3">Points</th>
              <th className="p-3">Organic</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.recent ?? []).map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="p-3 font-mono">{r.creatorAddress.slice(0, 8)}…</td>
                <td className="p-3">{POINTS_EVENT_LABEL[r.eventType] ?? r.eventType}</td>
                <td className="p-3 font-mono">
                  {String((r.metadata as { tokenSymbol?: string } | null)?.tokenSymbol ?? r.tokenAddress?.slice(0, 8) ?? "—")}
                </td>
                <td className="p-3 font-mono tabular-nums text-success">+{fmt(r.points)}</td>
                <td className="p-3 font-mono">
                  {String((r.metadata as { organicScore?: number } | null)?.organicScore ?? "—")}
                </td>
                <td className="p-3">{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {!(q.data?.recent ?? []).length && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={6}>
                  Todavía no hay entradas en el ledger.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-6">
        <AdminLevelsPanel csrf={csrf} />
        <AdminLevelHistoryPanel csrf={csrf} />

        <AdminAchievementsPanel csrf={csrf} />
      </div>
    </div>
  );
}
