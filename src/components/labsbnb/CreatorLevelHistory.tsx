// 🏆 Creator Level History (Fase 2C.1) — public, read-only timeline.
//
// The source of truth is the server-side `creator_level_history` ledger.
// localStorage is used ONLY to remember that a notification was already shown.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getCreatorLevelHistory, getLevelsConfig } from "@/lib/levels.functions";
import { levelTone } from "@/lib/levels/levels-types";

const fmt = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

const shownKey = (address: string) => `labsbnb.levelup.shown.${address.toLowerCase()}`;

export function CreatorLevelHistorySection({ address }: { address: string }) {
  const creator = address.toLowerCase();
  const notified = useRef(false);

  const q = useQuery({
    queryKey: ["creator-level-history", creator],
    queryFn: () => getCreatorLevelHistory({ data: { address } }),
    staleTime: 120_000,
  });
  const cfg = useQuery({ queryKey: ["levels-config"], queryFn: () => getLevelsConfig(), staleTime: 600_000 });

  const history = q.data?.history ?? [];
  const levels = cfg.data?.levels ?? [];
  const def = (level: number) => levels.find((l) => l.level === level) ?? null;

  // 🎉 Notification driven by the SERVER milestone, not by local state.
  const top = history.length ? history[history.length - 1]! : null;
  useEffect(() => {
    if (!top || notified.current) return;
    notified.current = true;
    try {
      const key = shownKey(creator);
      if (window.localStorage.getItem(key) === top.milestoneKey) return;
      window.localStorage.setItem(key, top.milestoneKey);
      const name = def(top.newLevel)?.name ?? `Level ${top.newLevel}`;
      const age = Date.now() - Date.parse(top.createdAt);
      if (Number.isFinite(age) && age < 7 * 24 * 60 * 60 * 1000) {
        toast.success(`🎉 Level Up! You reached ${name}.`);
      }
    } catch {
      /* storage unavailable — the timeline still renders */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creator, top?.milestoneKey]);

  if (q.isLoading && !q.data) return <div className="mt-6 glass h-32 animate-pulse rounded-2xl" />;
  if (!q.data) return null;

  const firstLevel = levels[0] ?? null;

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <h2 className="mb-3 font-display text-sm font-semibold">🏆 Level History</h2>

      <ol className="space-y-2">
        {firstLevel && (
          <li className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
            <span aria-hidden="true" className="text-base">
              {firstLevel.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">
                Level {firstLevel.level} — {firstLevel.name}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">Unlocked</span>
            </span>
          </li>
        )}

        {history.map((h) => {
          const d = def(h.newLevel);
          const tone = levelTone(h.newLevel);
          return (
            <li
              key={h.milestoneKey}
              className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs ${tone.border} ${tone.bg}`}
            >
              <span aria-hidden="true" className="text-base">
                {d?.icon ?? "🏆"}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${tone.text}`}>
                  Level {h.newLevel} — {d?.name ?? `Level ${h.newLevel}`}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {fmt(h.pointsAtLevelUp)} points · {day(h.createdAt)}
                  {h.backfill ? " · backfill" : ""}
                </span>
              </span>
              <span className={`shrink-0 text-[10px] uppercase tracking-widest ${tone.text}`}>Reached</span>
            </li>
          );
        })}
      </ol>

      {!history.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Todavía no hay milestones registrados para este creador. Los level-ups se registran de forma
          permanente en el servidor cuando se superan los umbrales de Creator Points.
        </p>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Historial inmutable y verificable: cada milestone se registra una sola vez y nunca se borra, aunque la
        configuración de niveles cambie. No otorga puntos ni recompensas.
      </p>
    </div>
  );
}
