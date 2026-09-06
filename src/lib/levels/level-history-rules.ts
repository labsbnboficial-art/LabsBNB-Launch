// 🏆 Creator Level History (Fase 2C.1) — pure, testable rules.
//
// No I/O: fingerprints, milestone keys and milestone diffing live here so the
// logic can be unit tested and reused from server and (read-only) client code.
//
// Level History is DERIVED from Creator Points and NEVER awards points.
import { calculateCreatorLevel } from "./levels-rules";
import { DEFAULT_LEVELS_CONFIG, type CreatorLevelsConfig } from "./levels-types";

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class LevelHistoryError extends Error {}

/** Consistent normalization: everything is stored and compared lowercase. */
export function normalizeAddress(address: string): string {
  const value = (address ?? "").trim();
  if (!ADDRESS_RE.test(value)) throw new LevelHistoryError("Dirección inválida.");
  return value.toLowerCase();
}

/** Stable milestone identifier — independent of the (editable) thresholds. */
export const milestoneKey = (level: number) => `creator_level_${level}`;

/** Deterministic idempotency input: LEVEL_UP|chainId|creator|level|milestone */
export function fingerprintInput(parts: {
  chainId: number;
  creatorAddress: string;
  newLevel: number;
}): string {
  return [
    "LEVEL_UP",
    String(parts.chainId),
    parts.creatorAddress.toLowerCase(),
    String(parts.newLevel),
    milestoneKey(parts.newLevel),
  ].join("|");
}

export async function fingerprint(parts: Parameters<typeof fingerprintInput>[0]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput(parts)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type LevelMilestone = {
  chainId: number;
  creatorAddress: string;
  previousLevel: number | null;
  newLevel: number;
  pointsAtLevelUp: number;
  milestoneKey: string;
  source: string;
  fingerprint: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type LevelHistoryEntry = {
  id: string;
  chainId: number;
  creatorAddress: string;
  previousLevel: number | null;
  newLevel: number;
  pointsAtLevelUp: number;
  milestoneKey: string;
  source: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  backfill: boolean;
};

/**
 * Levels whose milestone SHOULD exist for a creator with `totalPoints`.
 * Level 1 is the baseline (everybody starts there) and has no milestone event.
 */
export function expectedMilestoneLevels(
  totalPoints: number,
  config: CreatorLevelsConfig = DEFAULT_LEVELS_CONFIG,
): number[] {
  const current = calculateCreatorLevel(totalPoints, config).level;
  const out: number[] = [];
  for (let l = 2; l <= current; l += 1) out.push(l);
  return out;
}

/**
 * Milestones missing from `existingLevels`. Multi-level jumps produce one event
 * per crossed level, in ascending order, each with its own fingerprint.
 * Intermediate levels record their threshold; the newest level records the
 * creator's real current total.
 */
export async function detectMissingLevelMilestones(input: {
  chainId: number;
  creatorAddress: string;
  totalPoints: number;
  existingLevels: Iterable<number>;
  config?: CreatorLevelsConfig;
  backfill?: boolean;
}): Promise<LevelMilestone[]> {
  const config = input.config ?? DEFAULT_LEVELS_CONFIG;
  const creatorAddress = normalizeAddress(input.creatorAddress);
  const have = new Set<number>([...input.existingLevels]);
  const expected = expectedMilestoneLevels(input.totalPoints, config);
  const top = expected[expected.length - 1] ?? null;
  const thresholds = new Map(config.levels.map((l) => [l.level, l.minPoints]));

  const out: LevelMilestone[] = [];
  for (const level of expected) {
    if (have.has(level)) continue;
    const isTop = level === top;
    const points = isTop ? Math.max(0, Math.floor(input.totalPoints)) : (thresholds.get(level) ?? 0);
    out.push({
      chainId: input.chainId,
      creatorAddress,
      previousLevel: level - 1,
      newLevel: level,
      pointsAtLevelUp: points,
      milestoneKey: milestoneKey(level),
      source: "creator_points",
      fingerprint: await fingerprint({ chainId: input.chainId, creatorAddress, newLevel: level }),
      metadata: input.backfill
        ? { backfill: true, reason: "initial_level_history_migration", totalPointsAtDetection: Math.floor(input.totalPoints) }
        : { backfill: false, totalPointsAtDetection: Math.floor(input.totalPoints) },
    });
  }
  return out;
}
