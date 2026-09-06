// 🏆 Creator Levels — pure calculation + configuration validation.
// No I/O here so it is fully unit-testable and safe on client and server.
import {
  DEFAULT_LEVELS_CONFIG,
  MAX_LEVELS,
  type CreatorLevelDef,
  type CreatorLevelResult,
  type CreatorLevelsConfig,
} from "./levels-types";

export class LevelsConfigError extends Error {}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Levels sorted ascending by `minPoints` (config is validated, but be safe). */
export function sortedLevels(config: CreatorLevelsConfig): CreatorLevelDef[] {
  return [...config.levels].sort((a, b) => a.minPoints - b.minPoints || a.level - b.level);
}

/**
 * Single source of truth for the level of a creator.
 * Input is ALWAYS the server-computed SUM(creator_points_ledger.points).
 */
export function calculateCreatorLevel(
  totalPoints: number,
  config: CreatorLevelsConfig = DEFAULT_LEVELS_CONFIG,
): CreatorLevelResult {
  const levels = sortedLevels(config);
  const points = Number.isFinite(totalPoints) ? Math.max(0, Math.floor(totalPoints)) : 0;

  const first = levels[0] ?? DEFAULT_LEVELS_CONFIG.levels[0]!;
  let current: CreatorLevelDef = first;
  let next: CreatorLevelDef | null = null;

  for (let i = 0; i < levels.length; i += 1) {
    const def = levels[i]!;
    if (points >= def.minPoints) {
      current = def;
      next = levels[i + 1] ?? null;
    } else {
      next = next ?? def;
      break;
    }
  }
  if (points < first.minPoints) {
    current = first;
    next = levels[1] ?? null;
  }

  if (!next) {
    return {
      level: current.level,
      name: current.name,
      icon: current.icon,
      minPoints: current.minPoints,
      nextLevelMinPoints: null,
      nextLevelName: null,
      nextLevelIcon: null,
      pointsToNextLevel: 0,
      progressPercent: 100,
      totalPoints: points,
      benefits: current.benefits ?? [],
    };
  }

  const span = next.minPoints - current.minPoints;
  const raw = span > 0 ? ((points - current.minPoints) / span) * 100 : 100;

  return {
    level: current.level,
    name: current.name,
    icon: current.icon,
    minPoints: current.minPoints,
    nextLevelMinPoints: next.minPoints,
    nextLevelName: next.name,
    nextLevelIcon: next.icon,
    pointsToNextLevel: Math.max(0, next.minPoints - points),
    progressPercent: Math.round(clamp(raw, 0, 100)),
    totalPoints: points,
    benefits: current.benefits ?? [],
  };
}

/* ------------------------------- validation ------------------------------- */

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Number.isInteger(n);

/**
 * Validates an admin-submitted configuration. Throws `LevelsConfigError` with a
 * human-readable Spanish message so the Admin UI can display it directly.
 */
export function validateLevelsConfig(input: unknown): CreatorLevelsConfig {
  if (!input || typeof input !== "object") throw new LevelsConfigError("Configuración inválida.");
  const raw = input as Partial<CreatorLevelsConfig>;

  if (!Array.isArray(raw.levels) || raw.levels.length === 0) {
    throw new LevelsConfigError("Debe existir al menos un nivel.");
  }
  if (raw.levels.length > MAX_LEVELS) {
    throw new LevelsConfigError(`Máximo ${MAX_LEVELS} niveles.`);
  }

  const levels: CreatorLevelDef[] = raw.levels.map((l, i) => {
    const def = l as Partial<CreatorLevelDef>;
    if (!isInt(def.level) || def.level < 1) {
      throw new LevelsConfigError(`Nivel #${i + 1}: el número de nivel debe ser un entero >= 1.`);
    }
    const name = typeof def.name === "string" ? def.name.trim() : "";
    if (!name) throw new LevelsConfigError(`Nivel ${def.level}: el nombre no puede estar vacío.`);
    if (name.length > 40) throw new LevelsConfigError(`Nivel ${def.level}: nombre demasiado largo.`);
    const icon = typeof def.icon === "string" ? def.icon.trim() : "";
    if (!icon) throw new LevelsConfigError(`Nivel ${def.level}: falta el icono.`);
    if ([...icon].length > 3) throw new LevelsConfigError(`Nivel ${def.level}: icono inválido.`);
    if (!isInt(def.minPoints)) {
      throw new LevelsConfigError(`Nivel ${def.level}: los puntos mínimos deben ser un número entero.`);
    }
    if (def.minPoints < 0) {
      throw new LevelsConfigError(`Nivel ${def.level}: los puntos mínimos no pueden ser negativos.`);
    }
    if (def.minPoints > 100_000_000) {
      throw new LevelsConfigError(`Nivel ${def.level}: puntos mínimos fuera de rango.`);
    }
    const benefits = Array.isArray(def.benefits)
      ? def.benefits.filter((b): b is string => typeof b === "string").slice(0, 10)
      : [];
    return { level: def.level, name, icon, minPoints: def.minPoints, benefits };
  });

  const byLevel = new Set<number>();
  const byPoints = new Set<number>();
  for (const l of levels) {
    if (byLevel.has(l.level)) throw new LevelsConfigError(`El nivel ${l.level} está duplicado.`);
    if (byPoints.has(l.minPoints)) {
      throw new LevelsConfigError(`El umbral ${l.minPoints} está duplicado (nivel ${l.level}).`);
    }
    byLevel.add(l.level);
    byPoints.add(l.minPoints);
  }

  const ordered = [...levels].sort((a, b) => a.level - b.level);
  if (ordered[0]!.level !== 1) throw new LevelsConfigError("Debe existir el nivel 1.");
  if (ordered[0]!.minPoints !== 0) throw new LevelsConfigError("El nivel 1 debe empezar en 0 puntos.");
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.level !== ordered[i - 1]!.level + 1) {
      throw new LevelsConfigError("Los niveles deben ser consecutivos (1, 2, 3, …).");
    }
    if (ordered[i]!.minPoints <= ordered[i - 1]!.minPoints) {
      throw new LevelsConfigError(
        `El nivel ${ordered[i]!.level} debe tener más puntos que el nivel ${ordered[i - 1]!.level}.`,
      );
    }
  }

  return { enabled: raw.enabled !== false, levels: ordered };
}

/** Admin preview helper: sample points → resulting level. */
export const PREVIEW_POINTS = [0, 499, 500, 1_999, 2_000, 4_999, 5_000, 14_999, 15_000, 49_999, 50_000, 150_000];

export function previewLevels(config: CreatorLevelsConfig) {
  return PREVIEW_POINTS.map((points) => {
    const r = calculateCreatorLevel(points, config);
    return { points, level: r.level, name: r.name, icon: r.icon };
  });
}
