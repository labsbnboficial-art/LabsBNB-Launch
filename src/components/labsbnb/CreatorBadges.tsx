import { CREATOR_BADGE_LABEL, type CreatorBadge } from "@/lib/creator/creator-types";

export function CreatorBadges({ badges, limit }: { badges: CreatorBadge[]; limit?: number }) {
  const list = limit ? badges.slice(0, limit) : badges;
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((b) => (
        <span
          key={b}
          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {CREATOR_BADGE_LABEL[b]}
        </span>
      ))}
    </div>
  );
}

/** 🔥 Creator Score chip — colour scales with reputation, never with money. */
export function CreatorScoreChip({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const tone =
    score >= 75 ? "text-accent border-accent/40 bg-accent/10" :
    score >= 45 ? "text-primary border-primary/40 bg-primary/10" :
    "text-muted-foreground border-white/10 bg-white/5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-mono tabular-nums ${tone} ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      🔥 {score}/100
    </span>
  );
}
