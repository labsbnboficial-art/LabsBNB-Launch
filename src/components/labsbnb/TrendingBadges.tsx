import { BADGE_LABEL, type TrendingBadge } from "@/lib/trending/trending-types";
import { cn } from "@/lib/utils";

const TONE: Record<TrendingBadge, string> = {
  trending: "border-accent/40 bg-accent/10 text-accent",
  rising_fast: "border-success/40 bg-success/10 text-success",
  near_graduation: "border-primary/40 bg-primary/10 text-primary",
  graduation_soon: "border-primary/50 bg-primary/15 text-primary",
  whale_activity: "border-white/15 bg-white/5 text-foreground",
  volume_spike: "border-accent/30 bg-accent/5 text-accent",
};

export function TrendingBadges({
  badges,
  className,
  limit,
}: {
  badges: TrendingBadge[];
  className?: string;
  limit?: number;
}) {
  if (!badges.length) return null;
  const list = limit ? badges.slice(0, limit) : badges;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {list.map((b) => (
        <span
          key={b}
          className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4", TONE[b])}
        >
          {BADGE_LABEL[b]}
        </span>
      ))}
    </div>
  );
}

/** Compact 0–100 score chip; colour reflects the tier, never the price. */
export function ScoreChip({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 70 ? "border-accent/50 bg-accent/15 text-accent"
      : score >= 40 ? "border-primary/40 bg-primary/10 text-primary"
        : "border-white/10 bg-white/5 text-muted-foreground";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums", tone, className)}>
      {score}
    </span>
  );
}

/** ⚡ velocity label — "Building momentum" when there is not enough history. */
export function VelocityLabel({ value, className }: { value: number | null; className?: string }) {
  if (value == null) {
    return <span className={cn("text-[11px] text-muted-foreground", className)}>⚡ Building momentum</span>;
  }
  const positive = value >= 0;
  return (
    <span className={cn("font-mono text-[11px] tabular-nums", positive ? "text-success" : "text-muted-foreground", className)}>
      ⚡ {positive ? "+" : ""}{value.toFixed(0)}% Volume Velocity
    </span>
  );
}
