// 🏆 Creator Levels — reusable presentation components (Fase 2C).
// All values arrive already calculated by the server. This file never derives
// points, never writes anything and never touches on-chain state.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getCreatorLevel } from "@/lib/levels.functions";
import { calculateCreatorLevel } from "@/lib/levels/levels-rules";
import {
  DEFAULT_LEVELS_CONFIG,
  levelTone,
  type CreatorLevelResult,
  type CreatorLevelsConfig,
} from "@/lib/levels/levels-types";

const fmt = (n: number) => n.toLocaleString("en-US");

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
  lg: "px-3 py-1.5 text-sm gap-2",
};

export function CreatorLevelBadge({
  level,
  name,
  icon,
  size = "md",
  showName = true,
  showPoints = false,
  points,
  className = "",
}: {
  level: number;
  name: string;
  icon: string;
  size?: Size;
  showName?: boolean;
  showPoints?: boolean;
  points?: number;
  className?: string;
}) {
  const tone = levelTone(level);
  const label = `Nivel ${level}: ${name}${showPoints && points != null ? `, ${fmt(points)} puntos` : ""}`;
  return (
    <span
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center rounded-full border font-medium ${tone.border} ${tone.bg} ${tone.text} ${SIZE[size]} ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
      {showName && <span className="truncate">{name}</span>}
      {showPoints && points != null && (
        <span className="font-mono tabular-nums opacity-80">{fmt(points)} pts</span>
      )}
    </span>
  );
}

export function CreatorLevelProgress({ level }: { level: CreatorLevelResult }) {
  const tone = levelTone(level.level);
  const target = level.nextLevelMinPoints;
  const aria =
    target == null
      ? `${level.name}, ${fmt(level.totalPoints)} puntos, nivel máximo alcanzado`
      : `${level.name}, ${fmt(level.totalPoints)} puntos, ${level.progressPercent} por ciento de progreso hacia ${level.nextLevelName}`;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">
          {fmt(level.totalPoints)}
          {target != null ? ` / ${fmt(target)}` : ""}
        </span>
        <span className="font-mono tabular-nums">{level.progressPercent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={level.progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={aria}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/5"
      >
        <div className={`h-full ${tone.bar}`} style={{ width: `${level.progressPercent}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {target == null
          ? "Nivel máximo alcanzado."
          : `${fmt(level.pointsToNextLevel)} points to ${level.nextLevelName}`}
      </p>
    </div>
  );
}

export function CreatorLevelsOverview({
  config,
  currentLevel,
  totalPoints,
}: {
  config: CreatorLevelsConfig;
  currentLevel: number | null;
  totalPoints: number;
}) {
  return (
    <ol className="space-y-2">
      {config.levels.map((l) => {
        const tone = levelTone(l.level);
        const isCurrent = currentLevel === l.level;
        const done = currentLevel != null && l.level < currentLevel;
        const isNext = currentLevel != null && l.level === currentLevel + 1;
        const status = isCurrent ? "CURRENT LEVEL" : done ? "✓ Completed" : isNext ? "→ Next" : "Upcoming";
        return (
          <li
            key={l.level}
            aria-current={isCurrent ? "step" : undefined}
            className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs ${
              isCurrent ? `${tone.border} ${tone.bg}` : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <span aria-hidden="true" className="text-base">
              {l.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block ${isCurrent ? tone.text : ""}`}>
                Level {l.level} — {l.name}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{fmt(l.minPoints)}+ points</span>
            </span>
            <span
              className={`shrink-0 text-[10px] uppercase tracking-widest ${
                isCurrent ? tone.text : "text-muted-foreground"
              }`}
            >
              {status}
              {isCurrent ? ` · ${fmt(totalPoints)} pts` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------- profile section (public) ------------------------ */

const seenKey = (address: string) => `labsbnb.level.${address.toLowerCase()}`;

export function CreatorLevelSection({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const notified = useRef(false);

  const q = useQuery({
    queryKey: ["creator-level", address.toLowerCase()],
    queryFn: () => getCreatorLevel({ data: { address } }),
    staleTime: 120_000,
  });

  const data = q.data;
  const level = data?.level ?? null;

  // 🎉 Level-up: purely visual, idempotent (persisted per address, once per browser).
  useEffect(() => {
    if (!level || notified.current) return;
    try {
      const key = seenKey(address);
      const prev = Number(window.localStorage.getItem(key));
      if (Number.isFinite(prev) && prev > 0 && level.level > prev) {
        notified.current = true;
        toast.success(`🎉 Level Up! You reached ${level.name}.`);
      }
      window.localStorage.setItem(key, String(level.level));
    } catch {
      /* storage unavailable — the badge still renders */
    }
  }, [address, level]);

  if (q.isLoading && !data) return <div className="mt-6 glass h-32 animate-pulse rounded-2xl" />;

  if (data && !data.enabled) {
    return (
      <div className="mt-6 glass rounded-2xl p-4">
        <h2 className="font-display text-sm font-semibold">🏆 Creator Level</h2>
        <p className="mt-2 text-xs text-muted-foreground">Creator Levels temporarily unavailable.</p>
      </div>
    );
  }

  if (!level || !data) return null;

  const tone = levelTone(level.level);

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🏆 Creator Level</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-muted-foreground transition hover:text-foreground">
            Ver todos los niveles
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>🏆 Creator Levels</DialogTitle>
              <DialogDescription>
                Los niveles se derivan únicamente de los Creator Points acumulados. No son un token, no tienen
                valor monetario y no otorgan recompensas.
              </DialogDescription>
            </DialogHeader>
            <CreatorLevelsOverview
              config={data.config}
              currentLevel={level.level}
              totalPoints={level.totalPoints}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="text-3xl">
          {level.icon}
        </span>
        <div className="min-w-0">
          <div className={`font-display text-lg font-semibold ${tone.text}`}>{level.name}</div>
          <div className="font-mono text-xs text-muted-foreground tabular-nums">
            Level {level.level} · {fmt(level.totalPoints)} Points
          </div>
        </div>
      </div>

      <div className="mt-3">
        <CreatorLevelProgress level={level} />
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Creator Level es progresión derivada de Creator Points (contribución acumulada). No debe confundirse con
        el Creator Score, que mide calidad y reputación de 0 a 100.
      </p>
    </div>
  );
}

/** Client-side helper for lists that already received points from the server. */
export function levelFromPoints(points: number, config: CreatorLevelsConfig = DEFAULT_LEVELS_CONFIG) {
  return calculateCreatorLevel(points, config);
}
