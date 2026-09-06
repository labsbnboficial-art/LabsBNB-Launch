// 🏆 Creator Achievements (Fase 2D) — shared types + default catalog.
//
// Achievements are HISTORICAL, IMMUTABLE recognitions derived from real
// on-chain / engine data. They are NOT a second points system:
// an unlocked achievement is worth 0 Creator Points, by design.

export const ACHIEVEMENT_CATEGORIES = ["launch", "community", "trending", "graduation", "elite"] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export const RARITY_TONE: Record<AchievementRarity, string> = {
  common: "text-muted-foreground border-white/10",
  rare: "text-success border-success/30",
  epic: "text-accent border-accent/40",
  legendary: "text-warning border-warning/40",
};

export type AchievementDefinition = {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  enabled: boolean;
  displayOrder: number;
  /** Admin-editable thresholds consumed by the pure evaluators. */
  ruleConfig: Record<string, number>;
};

export type AchievementsConfig = {
  enabled: boolean;
  definitions: AchievementDefinition[];
};

/** Verifiable proof stored with every unlock (tx hash, block, metric, value…). */
export type AchievementEvidence = Record<string, string | number | boolean | null | string[]>;

export type AchievementProgress = { current: number; target: number; label: string } | null;

export type AchievementCandidate = {
  chainId: number;
  creatorAddress: string;
  achievementKey: string;
  sourceType: string;
  sourceId: string | null;
  evidence: AchievementEvidence;
  fingerprint: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type AchievementEntry = {
  id: string;
  chainId: number;
  creatorAddress: string;
  achievementKey: string;
  unlockedAt: string;
  sourceType: string;
  sourceId: string | null;
  evidence: AchievementEvidence;
  fingerprint: string;
  backfill: boolean;
};

/** One catalog row as returned to the UI/API (definition + unlock state). */
export type AchievementView = AchievementDefinition & {
  unlocked: boolean;
  unlockedAt: string | null;
  evidence: AchievementEvidence | null;
  progress: AchievementProgress;
  /** Unlocked but no longer part of the active catalog → legacy badge. */
  legacy: boolean;
};

export type CreatorAchievementsSummary = {
  creator: string;
  chainId: number;
  achievements: AchievementView[];
  totalAchievements: number;
  unlockedAchievements: number;
  completionPercentage: number;
  storageReady: boolean;
  storageError: string | null;
};

export type AchievementsEngineState = {
  lastRunAt: string | null;
  lastTrigger: string | null;
  creatorsEvaluated: number;
  achievementsUnlocked: number;
  duplicates: number;
  errors: number;
  durationMs: number;
  notes: string[];
};

export const EMPTY_ACHIEVEMENTS_STATE: AchievementsEngineState = {
  lastRunAt: null,
  lastTrigger: null,
  creatorsEvaluated: 0,
  achievementsUnlocked: 0,
  duplicates: 0,
  errors: 0,
  durationMs: 0,
  notes: [],
};

export type AchievementsRunResult = AchievementsEngineState & {
  runId: string;
  skipped: boolean;
  skippedReason: string | null;
  backfill: boolean;
};

/** Default catalog: 10 achievements, all backed by real, verifiable data. */
export const DEFAULT_ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    key: "first_launch",
    name: "First Launch",
    description: "Lanzó su primer token en LabsBNB Launchpad.",
    icon: "🚀",
    category: "launch",
    rarity: "common",
    enabled: true,
    displayOrder: 10,
    ruleConfig: {},
  },
  {
    key: "community_starter",
    name: "Community Starter",
    description: "Uno de sus tokens alcanzó 10 holders reales on-chain.",
    icon: "🌱",
    category: "community",
    rarity: "common",
    enabled: true,
    displayOrder: 20,
    ruleConfig: { holders: 10 },
  },
  {
    key: "community_builder",
    name: "Community Builder",
    description: "50+ holders reales con actividad orgánica verificada.",
    icon: "🏗️",
    category: "community",
    rarity: "epic",
    enabled: true,
    displayOrder: 30,
    ruleConfig: { holders: 50, minOrganicScore: 55, minBuyers: 15 },
  },
  {
    key: "trending_creator",
    name: "Trending Creator",
    description: "Un token suyo entró en el Top 5 del Trending.",
    icon: "🔥",
    category: "trending",
    rarity: "rare",
    enabled: true,
    displayOrder: 40,
    ruleConfig: { rank: 5 },
  },
  {
    key: "trending_master",
    name: "Trending Master",
    description: "Múltiples apariciones verificadas en el Top 5 del Trending.",
    icon: "👑",
    category: "trending",
    rarity: "epic",
    enabled: true,
    displayOrder: 50,
    ruleConfig: { appearances: 3 },
  },
  {
    key: "speed_runner",
    name: "Speed Runner",
    description: "Llegó a Near Graduation en menos de 24 horas desde el lanzamiento.",
    icon: "⚡",
    category: "graduation",
    rarity: "epic",
    enabled: true,
    displayOrder: 60,
    ruleConfig: { hours: 24 },
  },
  {
    key: "graduator",
    name: "Graduator",
    description: "Completó la Bonding Curve y graduó un token.",
    icon: "🎓",
    category: "graduation",
    rarity: "rare",
    enabled: true,
    displayOrder: 70,
    ruleConfig: {},
  },
  {
    key: "multi_graduator",
    name: "Multi Graduator",
    description: "Graduó 3 tokens distintos.",
    icon: "🏅",
    category: "graduation",
    rarity: "legendary",
    enabled: true,
    displayOrder: 80,
    ruleConfig: { graduations: 3 },
  },
  {
    key: "whale_magnet",
    name: "Whale Magnet",
    description: "Atrajo actividad de whales con trading orgánico y diverso.",
    icon: "🐋",
    category: "community",
    rarity: "rare",
    enabled: true,
    displayOrder: 90,
    ruleConfig: { whaleTrades: 2, minOrganicScore: 60, minBuyers: 8 },
  },
  {
    key: "creator_legend",
    name: "Creator Legend",
    description: "Nivel máximo de creador con graduaciones múltiples y dominio del Trending.",
    icon: "🌟",
    category: "elite",
    rarity: "legendary",
    enabled: true,
    displayOrder: 100,
    ruleConfig: { level: 7 },
  },
];

export const DEFAULT_ACHIEVEMENTS_CONFIG: AchievementsConfig = {
  enabled: true,
  definitions: DEFAULT_ACHIEVEMENT_DEFINITIONS,
};
