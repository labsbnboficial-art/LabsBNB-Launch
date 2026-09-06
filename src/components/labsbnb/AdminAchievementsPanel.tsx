// Admin → 🏆 Creator Points → 🏅 Achievements (Fase 2D).
// Definitions (enable/disable + thresholds), engine execution and immutable
// unlock history. Unlocks can never be edited or deleted from the app.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, History, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  getAchievementsOverview,
  runAchievementsEngineFn,
  saveAchievementsConfig,
} from "@/lib/achievements.functions";
import type { AchievementDefinition, AchievementsConfig } from "@/lib/achievements/achievement-types";

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US") : "N/A");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AdminAchievementsPanel({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getAchievementsOverview);
  const saveFn = useServerFn(saveAchievementsConfig);
  const runFn = useServerFn(runAchievementsEngineFn);

  const [draft, setDraft] = useState<AchievementsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<"" | "run" | "backfill">("");

  const q = useQuery({ queryKey: ["admin-achievements"], queryFn: () => overviewFn({ data: { csrf } }) });

  useEffect(() => {
    if (q.data?.config && !draft) setDraft(q.data.config);
  }, [q.data, draft]);

  const patch = (key: string, change: Partial<AchievementDefinition>) =>
    setDraft((d) =>
      d ? { ...d, definitions: d.definitions.map((x) => (x.key === key ? { ...x, ...change } : x)) } : d,
    );

  const patchRule = (key: string, ruleKey: string, value: number) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            definitions: d.definitions.map((x) =>
              x.key === key ? { ...x, ruleConfig: { ...x.ruleConfig, [ruleKey]: value } } : x,
            ),
          }
        : d,
    );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveFn({ data: { csrf, config: draft } });
      toast.success("Configuración de Achievements guardada.");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  const run = async (mode: "run" | "backfill") => {
    setRunning(mode);
    try {
      const res = await runFn({ data: { csrf, backfill: mode === "backfill" } });
      if (res.skipped) toast.warning(res.skippedReason ?? "Ejecución omitida.");
      else toast.success(`Motor completado: ${res.achievementsUnlocked} logros nuevos.`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar el motor.");
    } finally {
      setRunning("");
    }
  };

  const state = q.data?.state;
  const recent = q.data?.recent ?? [];

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold">🏅 Achievements</h3>
          <p className="text-[11px] text-muted-foreground">
            Logros históricos e inmutables. No otorgan Creator Points y no se pueden borrar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run("run")} disabled={running !== ""}>
            {running === "run" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run Achievements Engine
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("backfill")} disabled={running !== ""}>
            {running === "backfill" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <History className="mr-2 h-4 w-4" />
            )}
            Backfill inicial
          </Button>
        </div>
      </div>

      {q.data && !q.data.storageReady && (
        <p className="mb-3 rounded-lg border border-dashed border-warning/40 p-2 text-[11px] text-warning">
          Tabla `creator_achievements` no disponible{q.data.storageError ? `: ${q.data.storageError}` : ""}. Ejecuta
          docs/SQL_CREATOR_ACHIEVEMENTS.md en Supabase.
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ["Last run", dt(state?.lastRunAt ?? null)],
          ["Creadores evaluados", String(state?.creatorsEvaluated ?? 0)],
          ["Logros desbloqueados", String(state?.achievementsUnlocked ?? 0)],
          ["Duplicados", String(state?.duplicates ?? 0)],
          ["Errores", String(state?.errors ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className="font-mono text-xs tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            Motor de Achievements activo
          </label>

          {draft.definitions.map((d) => (
            <div key={d.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="text-lg">
                  {d.icon}
                </span>
                <span className="text-sm">{d.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {d.category} · {d.rarity}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[11px]">
                  Activo
                  <Switch checked={d.enabled} onCheckedChange={(v) => patch(d.key, { enabled: v })} />
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{d.description}</p>
              {Object.keys(d.ruleConfig).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(d.ruleConfig).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-1 text-[11px]">
                      <span className="text-muted-foreground">{k}</span>
                      <Input
                        type="number"
                        value={v}
                        min={0}
                        onChange={(e) => patchRule(d.key, k, Number(e.target.value))}
                        className="h-7 w-24 text-xs"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar configuración
          </Button>
        </div>
      )}

      <div className="mt-5">
        <h4 className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">Historial reciente</h4>
        {recent.length ? (
          <ol className="space-y-1">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{dt(e.unlockedAt)}</span>
                <span className="font-mono">{short(e.creatorAddress)}</span>
                <span>{e.achievementKey}</span>
                {e.backfill && <span className="text-muted-foreground">· backfill</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-muted-foreground">Sin logros registrados todavía.</p>
        )}
      </div>
    </div>
  );
}
