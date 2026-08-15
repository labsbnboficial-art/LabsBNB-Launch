// Admin → Telegram → Signal Engine.
// Master switch, per-signal toggles, thresholds, manual run, live preview and
// the persisted history. All values are validated again on the server.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SIGNAL_CONFIG,
  SIGNAL_LABELS,
  SIGNAL_TYPES,
  type SignalConfig,
  type SignalRunResult,
  type SignalType,
} from "@/lib/signals/signal-types";
import {
  getSignalOverview,
  listSignalHistory,
  previewSignal,
  runSignalsNow,
  saveSignalConfig,
} from "@/lib/signals.functions";
import { AlertTriangle, Eye, Loader2, Play, RefreshCw, Save } from "lucide-react";

type NumKey = Exclude<keyof SignalConfig, "engine_enabled" | "enabled" | "bonding_milestones">;

const FIELDS: { key: NumKey; label: string; step?: string; hint?: string }[] = [
  { key: "scan_tokens", label: "Tokens escaneados por run", hint: "1–50" },
  { key: "max_sends_per_run", label: "Máx. mensajes por run", hint: "1–30" },
  { key: "volume_min_bnb", label: "Volumen mínimo (BNB)", step: "0.01" },
  { key: "volume_multiplier", label: "Multiplicador de volumen (x)", step: "0.1", hint: "> 1" },
  { key: "volume_window_min", label: "Ventana de volumen (min)" },
  { key: "volume_min_baseline_windows", label: "Ventanas de histórico mínimas" },
  { key: "volume_cooldown_min", label: "Cooldown volumen (min)" },
  { key: "whale_buy_bnb", label: "Whale Buy ≥ (BNB)", step: "0.01" },
  { key: "whale_sell_bnb", label: "Whale Sell ≥ (BNB)", step: "0.01" },
  { key: "whale_cooldown_min", label: "Cooldown whales (min)" },
  { key: "ath_min_change_pct", label: "ATH: subida mínima (%)", step: "0.1" },
  { key: "ath_cooldown_min", label: "Cooldown ATH (min)" },
  { key: "koth_cooldown_min", label: "Cooldown King of the Hill (min)" },
  { key: "new_token_cooldown_min", label: "Cooldown nuevo token (min)" },
  { key: "graduation_cooldown_min", label: "Cooldown graduación (min)" },
];

const STATUS_STYLE: Record<string, string> = {
  SENT: "border-emerald-400/30 text-emerald-300",
  SKIPPED: "border-amber-400/30 text-amber-200",
  FAILED: "border-rose-400/30 text-rose-300",
  PENDING: "border-white/15 text-muted-foreground",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold">{value}</p>
    </div>
  );
}

export function AdminSignalsPanel({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getSignalOverview);
  const saveFn = useServerFn(saveSignalConfig);
  const runFn = useServerFn(runSignalsNow);
  const previewFn = useServerFn(previewSignal);
  const historyFn = useServerFn(listSignalHistory);

  const [cfg, setCfg] = useState<SignalConfig>(DEFAULT_SIGNAL_CONFIG);
  const [milestones, setMilestones] = useState(DEFAULT_SIGNAL_CONFIG.bonding_milestones.join(", "));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<SignalRunResult | null>(null);
  const [preview, setPreview] = useState<{ type: SignalType; text: string; real: boolean } | null>(null);
  const [previewType, setPreviewType] = useState<SignalType>("NEW_TOKEN");
  const [previewAddress, setPreviewAddress] = useState("");

  const [fStatus, setFStatus] = useState<"" | "SENT" | "SKIPPED" | "FAILED">("");
  const [fType, setFType] = useState<"" | SignalType>("");
  const [fToken, setFToken] = useState("");
  const [page, setPage] = useState(1);

  const overview = useQuery({
    queryKey: ["admin-signal-overview"],
    queryFn: () => overviewFn({ data: { csrf } }),
  });

  const history = useQuery({
    queryKey: ["admin-signal-history", fStatus, fType, fToken, page],
    queryFn: () =>
      historyFn({
        data: {
          csrf,
          ...(fStatus ? { status: fStatus } : {}),
          ...(fType ? { type: fType } : {}),
          ...(fToken.trim() ? { token: fToken.trim() } : {}),
          page,
          pageSize: 25,
        },
      }),
    retry: false,
  });

  useEffect(() => {
    if (overview.data?.config) {
      setCfg(overview.data.config as SignalConfig);
      setMilestones((overview.data.config as SignalConfig).bonding_milestones.join(", "));
    }
  }, [overview.data]);

  const state = overview.data?.state;
  const counts = overview.data?.counts;
  const storageReady = overview.data?.storageReady ?? true;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((history.data?.total ?? 0) / (history.data?.pageSize ?? 25))),
    [history.data],
  );

  async function persist(next: SignalConfig) {
    setSaving(true);
    try {
      const parsed = milestones
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      const r = await saveFn({ data: { csrf, config: { ...next, bonding_milestones: parsed } } });
      setCfg(r.config as SignalConfig);
      setMilestones((r.config as SignalConfig).bonding_milestones.join(", "));
      toast.success("Configuración guardada.");
      overview.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    setRunning(true);
    try {
      const r = await runFn({ data: { csrf } });
      setLastRun(r);
      if (r.failed > 0) toast.error(`Run con ${r.failed} fallo(s).`);
      else toast.success(`Run completado: ${r.sent} enviadas, ${r.skipped} omitidas.`);
      overview.refetch();
      history.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error ejecutando el motor.");
    } finally {
      setRunning(false);
    }
  }

  async function doPreview() {
    try {
      const r = await previewFn({
        data: { csrf, type: previewType, ...(previewAddress.trim() ? { address: previewAddress.trim() } : {}) },
      });
      setPreview({ type: previewType, text: r.text, real: r.real });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar la previsualización.");
    }
  }

  return (
    <div className="space-y-6">
      {!storageReady && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Falta la tabla <code className="font-mono">signal_log</code>. Aplica{" "}
          <code className="font-mono">docs/SQL_SIGNALS.md</code> en Supabase. Motivo:{" "}
          {overview.data?.storageError ?? "tabla no encontrada"}.
        </p>
      )}

      {/* Master control */}
      <div className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-semibold">Signal Engine</h3>
            <p className="text-xs text-muted-foreground">
              Publica señales reales del launchpad en el canal. Deduplicación persistente por evento.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="engine" className="text-xs uppercase tracking-widest text-muted-foreground">
              {cfg.engine_enabled ? "Activo" : "Detenido"}
            </Label>
            <Switch
              id="engine"
              checked={cfg.engine_enabled}
              onCheckedChange={(v) => persist({ ...cfg, engine_enabled: v })}
              disabled={saving}
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Enviadas" value={counts?.SENT ?? 0} />
          <Stat label="Omitidas" value={counts?.SKIPPED ?? 0} />
          <Stat label="Fallidas" value={counts?.FAILED ?? 0} />
          <Stat
            label="Última ejecución"
            value={state?.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : "Nunca"}
          />
        </div>

        {state?.lastError && (
          <p className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/5 p-3 text-xs text-rose-200">
            Último error: {state.lastError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            RUN ENGINE NOW
          </Button>
          <Button variant="outline" onClick={() => overview.refetch()} disabled={overview.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        {lastRun && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs text-muted-foreground">
            <p className="text-foreground">
              {lastRun.tokensScanned} tokens · {lastRun.detected} detectadas · {lastRun.sent} enviadas ·{" "}
              {lastRun.skipped} omitidas · {lastRun.failed} fallidas
            </p>
            {lastRun.notes.map((n, i) => (
              <p key={i} className="mt-1">
                • {n}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Signal types */}
      <div className="glass rounded-3xl p-6">
        <h4 className="font-display text-base font-semibold">Tipos de señal</h4>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {SIGNAL_TYPES.map((t) => (
            <div
              key={t}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <span className="text-sm">{SIGNAL_LABELS[t]}</span>
              <Switch
                checked={cfg.enabled[t]}
                onCheckedChange={(v) => setCfg({ ...cfg, enabled: { ...cfg.enabled, [t]: v } })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Thresholds */}
      <div className="glass rounded-3xl p-6">
        <h4 className="font-display text-base font-semibold">Umbrales y cooldowns</h4>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">{f.label}</Label>
              <Input
                type="number"
                step={f.step ?? "1"}
                value={String(cfg[f.key])}
                onChange={(e) => setCfg({ ...cfg, [f.key]: Number(e.target.value) })}
              />
              {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <div className="space-y-1.5 md:col-span-3">
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Hitos de bonding (%) separados por coma
            </Label>
            <Input value={milestones} onChange={(e) => setMilestones(e.target.value)} />
          </div>
        </div>
        <Button className="mt-5" onClick={() => persist(cfg)} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar configuración
        </Button>
      </div>

      {/* Preview */}
      <div className="glass rounded-3xl p-6">
        <h4 className="font-display text-base font-semibold">Previsualizar señal</h4>
        <p className="text-xs text-muted-foreground">
          Renderiza el mensaje exacto sin publicarlo. Con dirección de token usa datos reales on-chain.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <select
            className="h-10 rounded-xl border border-white/10 bg-background px-3 text-sm"
            value={previewType}
            onChange={(e) => setPreviewType(e.target.value as SignalType)}
          >
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {SIGNAL_LABELS[t]}
              </option>
            ))}
          </select>
          <Input
            placeholder="0x… (opcional, datos reales)"
            value={previewAddress}
            onChange={(e) => setPreviewAddress(e.target.value)}
          />
          <Button variant="outline" onClick={doPreview}>
            <Eye className="mr-2 h-4 w-4" />
            Previsualizar
          </Button>
        </div>
        {preview && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <Badge variant="outline" className="mb-2 border-white/15 text-[10px]">
              {preview.real ? "Datos reales" : "Ejemplo (sin datos on-chain)"}
            </Badge>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {preview.text.replace(/<[^>]+>/g, "")}
            </pre>
          </div>
        )}
      </div>

      {/* History */}
      <div className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-display text-base font-semibold">Historial de señales</h4>
          <Button variant="outline" size="sm" onClick={() => history.refetch()} disabled={history.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${history.isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <select
            className="h-10 rounded-xl border border-white/10 bg-background px-3 text-sm"
            value={fStatus}
            onChange={(e) => {
              setPage(1);
              setFStatus(e.target.value as typeof fStatus);
            }}
          >
            <option value="">Todos los estados</option>
            <option value="SENT">SENT</option>
            <option value="SKIPPED">SKIPPED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select
            className="h-10 rounded-xl border border-white/10 bg-background px-3 text-sm"
            value={fType}
            onChange={(e) => {
              setPage(1);
              setFType(e.target.value as typeof fType);
            }}
          >
            <option value="">Todos los tipos</option>
            {SIGNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {SIGNAL_LABELS[t]}
              </option>
            ))}
          </select>
          <Input
            placeholder="Filtrar por token 0x…"
            value={fToken}
            onChange={(e) => {
              setPage(1);
              setFToken(e.target.value);
            }}
          />
        </div>

        {history.error && (
          <p className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/5 p-3 text-xs text-rose-200">
            {history.error instanceof Error ? history.error.message : "No se pudo leer el historial."}
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(history.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-2 pr-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{SIGNAL_LABELS[r.signal_type as SignalType] ?? r.signal_type}</td>
                  <td className="py-2 pr-3 font-mono">
                    {r.token_symbol ?? (r.token_address ? `${r.token_address.slice(0, 8)}…` : "—")}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline" className={STATUS_STYLE[r.status] ?? "border-white/15"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {r.error ?? r.reason ?? (r.telegram_message_id ? `msg #${r.telegram_message_id}` : "—")}
                  </td>
                </tr>
              ))}
              {!history.isLoading && !(history.data?.rows ?? []).length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    Sin señales registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Página {history.data?.page ?? 1} de {totalPages} · {history.data?.total ?? 0} registros
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
