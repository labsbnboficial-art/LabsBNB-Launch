// Admin → 🏆 Creator Points → Creator Levels (Fase 2C).
// Edits the persistent `creator_levels` key in `admin_config`.
// Levels are DERIVED from Creator Points: this panel never touches the ledger.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getLevelsOverview, saveLevelsConfig } from "@/lib/levels.functions";
import { previewLevels, validateLevelsConfig } from "@/lib/levels/levels-rules";
import { DEFAULT_LEVELS_CONFIG, type CreatorLevelsConfig } from "@/lib/levels/levels-types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function AdminLevelsPanel({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getLevelsOverview);
  const saveFn = useServerFn(saveLevelsConfig);

  const q = useQuery({ queryKey: ["admin-levels"], queryFn: () => overviewFn({ data: { csrf } }) });

  const [cfg, setCfg] = useState<CreatorLevelsConfig>(DEFAULT_LEVELS_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data?.config) setCfg(q.data.config);
  }, [q.data?.config]);

  let error: string | null = null;
  let preview: { points: number; level: number; name: string; icon: string }[] = [];
  try {
    preview = previewLevels(validateLevelsConfig(cfg));
  } catch (e) {
    error = e instanceof Error ? e.message : "Configuración inválida.";
  }

  const patch = (level: number, next: Partial<CreatorLevelsConfig["levels"][number]>) =>
    setCfg((c) => ({ ...c, levels: c.levels.map((l) => (l.level === level ? { ...l, ...next } : l)) }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveFn({ data: { csrf, config: cfg } });
      setCfg(res.config);
      toast.success("Configuración de Creator Levels guardada.");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold">🏆 Creator Levels</h3>
          <p className="text-[11px] text-muted-foreground">
            Progresión derivada de los Creator Points. Cambiar los umbrales recalcula el nivel mostrado, nunca
            modifica el ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="levels-enabled" className="text-xs">
            Sistema activo
          </Label>
          <Switch
            id="levels-enabled"
            checked={cfg.enabled}
            onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v }))}
          />
        </div>
      </div>

      {q.isLoading && !q.data ? (
        <div className="h-40 animate-pulse rounded-xl bg-white/5" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Level</th>
                  <th className="p-2 text-left">Icon</th>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Minimum Points</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {cfg.levels.map((l) => (
                  <tr key={l.level} className="border-t border-white/5">
                    <td className="p-2 font-mono tabular-nums">{l.level}</td>
                    <td className="p-2">
                      <Input
                        value={l.icon}
                        aria-label={`Icono del nivel ${l.level}`}
                        onChange={(e) => patch(l.level, { icon: e.target.value })}
                        className="h-8 w-16 text-center"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        value={l.name}
                        aria-label={`Nombre del nivel ${l.level}`}
                        onChange={(e) => patch(l.level, { name: e.target.value })}
                        className="h-8"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={l.minPoints}
                        aria-label={`Puntos mínimos del nivel ${l.level}`}
                        disabled={l.level === 1}
                        onChange={(e) => patch(l.level, { minPoints: Math.floor(Number(e.target.value) || 0) })}
                        className="h-8 w-32 font-mono tabular-nums"
                      />
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {cfg.enabled ? "Activo" : "Desactivado"}
                      {l.level === 1 ? " · base 0" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          ) : (
            <div className="mt-3">
              <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Preview Level System
              </p>
              <div className="grid gap-1 text-[11px] md:grid-cols-2 lg:grid-cols-3">
                {preview.map((p) => (
                  <div key={p.points} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1">
                    <span className="font-mono tabular-nums text-muted-foreground">{fmt(p.points)} pts</span>
                    <span>
                      <span aria-hidden="true">{p.icon}</span> {p.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving || !!error}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar niveles
            </Button>
            <Button variant="outline" onClick={() => setCfg(DEFAULT_LEVELS_CONFIG)} disabled={saving}>
              Restaurar valores por defecto
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
