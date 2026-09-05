// Admin → Trending Engine.
// Status, observability counters, manual run and every tunable weight.
// Every value is re-validated on the server before being stored.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getTrendingOverview, runTrendingNow, saveTrendingConfig } from "@/lib/trending.functions";
import { DEFAULT_TRENDING_CONFIG, type TrendingConfig, type TrendingWeights } from "@/lib/trending/trending-types";

const WEIGHTS: { key: keyof TrendingWeights; label: string }[] = [
  { key: "momentum", label: "Momentum / Volumen" },
  { key: "buyers", label: "Compradores" },
  { key: "holders", label: "Holders" },
  { key: "bonding", label: "Bonding progress" },
  { key: "whales", label: "Whales" },
  { key: "activity", label: "Actividad reciente" },
];

const NUMS: { key: keyof TrendingConfig; label: string; step?: string; hint?: string }[] = [
  { key: "scan_tokens", label: "Tokens escaneados por run", hint: "1–100" },
  { key: "min_trades_24h", label: "Actividad mínima (trades 24h)", hint: "0 = sin filtro" },
  { key: "velocity_threshold", label: "Umbral de velocity (%)", step: "1" },
  { key: "near_graduation_pct", label: "Umbral Near Graduation (%)", step: "1" },
  { key: "whale_bnb", label: "Whale trade ≥ (BNB)", step: "0.01" },
];

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold">{value}</p>
    </div>
  );
}

export function AdminTrendingTab({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getTrendingOverview);
  const saveFn = useServerFn(saveTrendingConfig);
  const runFn = useServerFn(runTrendingNow);

  const q = useQuery({
    queryKey: ["admin-trending"],
    queryFn: () => overviewFn({ data: { csrf } }),
  });

  const [cfg, setCfg] = useState<TrendingConfig>(DEFAULT_TRENDING_CONFIG);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (q.data?.config) setCfg(q.data.config);
  }, [q.data?.config]);

  const state = q.data?.state;

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveFn({ data: { csrf, config: cfg } });
      setCfg(res.config);
      toast.success("Configuración del Trending Engine guardada.");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      const res = await runFn({ data: { csrf } });
      if (res.skipped === "disabled") toast.warning("El motor está desactivado.");
      else if (res.skipped === "locked") toast.warning("Ya hay una ejecución en curso.");
      else toast.success(`Trending Engine ejecutado: ${res.ranked} tokens rankeados.`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {q.data && !q.data.storageReady && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
          <div>
            <p className="font-medium text-amber-200">Tabla de snapshots no disponible</p>
            <p className="text-muted-foreground">
              Ejecuta <span className="font-mono">docs/SQL_TRENDING_ENGINE.md</span> en Supabase. Mientras tanto el
              ranking se calcula bajo demanda con caché en memoria.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Última ejecución" value={state?.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : "—"} />
        <Stat label="Tokens escaneados" value={state?.tokensScanned ?? 0} />
        <Stat label="Tokens rankeados" value={state?.tokensRanked ?? 0} />
        <Stat label="Tokens excluidos" value={state?.tokensExcluded ?? 0} />
        <Stat label="Duración" value={`${state?.durationMs ?? 0} ms`} />
        <Stat label="Errores" value={state?.errors ?? 0} />
        <Stat label="Trigger" value={state?.lastTrigger ?? "—"} />
        <Stat label="Intervalo" value={`${cfg.scan_interval_min} min`} />
      </div>

      {state?.lastError && (
        <p className="rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-2 text-xs text-rose-200">
          Último error: {state.lastError}
        </p>
      )}
      {!!state?.notes?.length && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {state.notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <Switch
          checked={cfg.engine_enabled}
          onCheckedChange={(v) => setCfg((c) => ({ ...c, engine_enabled: v }))}
          id="trending-enabled"
        />
        <Label htmlFor="trending-enabled">Motor activo</Label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => q.refetch()} className="border-white/10 bg-white/5">
            <RefreshCw className="mr-2 h-4 w-4" /> Refrescar
          </Button>
          <Button onClick={run} disabled={running} className="brand-gradient text-primary-foreground">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Ejecutar ahora
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="mb-3 text-sm font-medium">Intervalo de escaneo</p>
        <div className="flex gap-2">
          {[1, 3, 5].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setCfg((c) => ({ ...c, scan_interval_min: m }))}
              className={`rounded-full border px-3 py-1 text-xs ${
                cfg.scan_interval_min === m
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-white/10 bg-white/5 text-muted-foreground"
              }`}
            >
              {m} min
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El cron externo debe llamar a <span className="font-mono">/api/public/trending/run</span> con este ritmo.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-3 text-sm font-medium">Pesos del Trending Score</p>
          <div className="space-y-3">
            {WEIGHTS.map((w) => (
              <div key={w.key} className="grid grid-cols-[1fr_100px] items-center gap-3">
                <Label className="text-xs text-muted-foreground">{w.label}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={cfg.weights[w.key]}
                  onChange={(e) =>
                    setCfg((c) => ({ ...c, weights: { ...c.weights, [w.key]: Number(e.target.value) } }))
                  }
                />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Suma actual: {Object.values(cfg.weights).reduce((s, v) => s + v, 0)} (se normaliza automáticamente).
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-3 text-sm font-medium">Umbrales</p>
          <div className="space-y-3">
            {NUMS.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
                <Label className="text-xs text-muted-foreground">
                  {f.label}
                  {f.hint && <span className="ml-1 text-[10px] opacity-60">({f.hint})</span>}
                </Label>
                <Input
                  type="number"
                  step={f.step}
                  value={String(cfg[f.key] as number)}
                  onChange={(e) => setCfg((c) => ({ ...c, [f.key]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="brand-gradient text-primary-foreground">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}
