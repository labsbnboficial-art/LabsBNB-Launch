// 🏆 LabsBNB Creator Levels (Fase 2C) — shared types + default configuration.
//
// Creator Levels are DERIVED STATE from Creator Points:
//   • not a second points system — the only source of truth is
//     `creator_points_ledger` (SUM of points), exactly as Fase 2B computes it
//   • not a token, not BNB, no monetary value, no rewards, no airdrops
//   • never writes to the ledger and never touches on-chain state
//
// Configuration is persisted in the existing `admin_config` table under the
// key `creator_levels` (see src/lib/levels/levels-config.server.ts).

export type CreatorLevelDef = {
  level: number;
  name: string;
  icon: string;
  minPoints: number;
  /** Reserved for future non-monetary perks (badges, highlights). Never BNB. */
  benefits: string[];
};

export type CreatorLevelsConfig = {
  enabled: boolean;
  levels: CreatorLevelDef[];
};

export const MAX_LEVELS = 20;

export const DEFAULT_LEVELS_CONFIG: CreatorLevelsConfig = {
  enabled: true,
  levels: [
    { level: 1, name: "New Creator", icon: "🏁", minPoints: 0, benefits: ["profile_badge"] },
    { level: 2, name: "Rising Creator", icon: "🌱", minPoints: 500, benefits: ["profile_badge"] },
    { level: 3, name: "Active Creator", icon: "🔥", minPoints: 2_000, benefits: ["profile_badge"] },
    { level: 4, name: "Pro Creator", icon: "⚡", minPoints: 5_000, benefits: ["profile_badge"] },
    { level: 5, name: "Elite Creator", icon: "💎", minPoints: 15_000, benefits: ["profile_badge"] },
    { level: 6, name: "Master Creator", icon: "👑", minPoints: 50_000, benefits: ["profile_badge"] },
    {
      level: 7,
      name: "Legend Creator",
      icon: "🏆",
      minPoints: 150_000,
      benefits: ["profile_badge", "creator_page_highlight"],
    },
  ],
};

/** Result of `calculateCreatorLevel(totalPoints)` — always server-calculated. */
export type CreatorLevelResult = {
  level: number;
  name: string;
  icon: string;
  minPoints: number;
  nextLevelMinPoints: number | null;
  nextLevelName: string | null;
  nextLevelIcon: string | null;
  pointsToNextLevel: number;
  progressPercent: number;
  totalPoints: number;
  benefits: string[];
};

/** Visual identity per level — Tailwind classes bound to design tokens only. */
export const LEVEL_TONE: Record<number, { text: string; bg: string; border: string; bar: string }> = {
  1: { text: "text-muted-foreground", bg: "bg-white/5", border: "border-white/10", bar: "bg-muted-foreground/60" },
  2: { text: "text-success", bg: "bg-success/10", border: "border-success/30", bar: "bg-success" },
  3: { text: "text-warning", bg: "bg-warning/10", border: "border-warning/30", bar: "bg-warning" },
  4: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/30", bar: "bg-primary" },
  5: { text: "text-accent", bg: "bg-accent/10", border: "border-accent/30", bar: "bg-accent" },
  6: { text: "text-gold", bg: "bg-gold/10", border: "border-gold/30", bar: "bg-gold" },
  7: { text: "text-gold", bg: "bg-gold/15", border: "border-gold/50", bar: "brand-gradient" },
};

export const levelTone = (level: number) => LEVEL_TONE[level] ?? LEVEL_TONE[1]!;
