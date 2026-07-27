// Client-safe helpers for the Labs Missions XP / level system.

export type TaskType =
  | "follow_labsbnb"
  | "follow_project"
  | "like"
  | "repost"
  | "tweet"
  | "telegram"
  | "discord"
  | "buy_min"
  | "hold"
  | "stake"
  | "vote"
  | "favorite"
  | "profile"
  | "referral"
  | "comment";

export type TaskGroup = "social" | "chain" | "community";

export type TaskSpec = {
  type: TaskType;
  label: string;
  group: TaskGroup;
  /** auto = verificable por la plataforma; manual = requiere aprobación */
  verification: "auto" | "manual";
  /** qué debe enviar el usuario como prueba */
  proof: "none" | "url" | "handle" | "tx";
  xp: number;
  help?: string;
};

export const TASK_CATALOG: TaskSpec[] = [
  { type: "follow_labsbnb", label: "Seguir a @LabsBNBOficial en X", group: "social", verification: "manual", proof: "handle", xp: 20 },
  { type: "follow_project", label: "Seguir al proyecto en X", group: "social", verification: "manual", proof: "handle", xp: 20 },
  { type: "like", label: 'Dar "Me gusta" a la publicación', group: "social", verification: "manual", proof: "url", xp: 10 },
  { type: "repost", label: "Repostear la publicación", group: "social", verification: "manual", proof: "url", xp: 20 },
  { type: "tweet", label: "Publicar un tweet mencionando a LabsBNB y al proyecto", group: "social", verification: "manual", proof: "url", xp: 40 },
  { type: "telegram", label: "Unirse al Telegram", group: "social", verification: "manual", proof: "handle", xp: 15 },
  { type: "discord", label: "Unirse al Discord", group: "social", verification: "manual", proof: "handle", xp: 15 },
  { type: "buy_min", label: "Comprar una cantidad mínima del token", group: "chain", verification: "auto", proof: "none", xp: 50, help: "Verificado contra el historial de trades." },
  { type: "hold", label: "Mantener el token durante X horas", group: "chain", verification: "auto", proof: "none", xp: 60, help: "Compra sin venta posterior durante el periodo." },
  { type: "stake", label: "Hacer staking de LabsBNB", group: "chain", verification: "manual", proof: "tx", xp: 60 },
  { type: "vote", label: "Votar el proyecto", group: "chain", verification: "auto", proof: "none", xp: 10 },
  { type: "favorite", label: "Añadir el token a favoritos", group: "chain", verification: "auto", proof: "none", xp: 10 },
  { type: "profile", label: "Completar el perfil", group: "community", verification: "auto", proof: "none", xp: 15 },
  { type: "referral", label: "Invitar amigos con tu enlace de referido", group: "community", verification: "auto", proof: "none", xp: 40 },
  { type: "comment", label: "Comentar en la página del proyecto", group: "community", verification: "auto", proof: "none", xp: 15 },
];

export function taskSpec(type: string): TaskSpec | undefined {
  return TASK_CATALOG.find((t) => t.type === type);
}

export type LevelKey = "explorer" | "contributor" | "ambassador" | "elite" | "legend";

export type LevelSpec = {
  key: LevelKey;
  label: string;
  emoji: string;
  min: number;
  feeDiscountBps: number;
  perks: string[];
};

export const LEVELS: LevelSpec[] = [
  { key: "explorer", label: "Explorer", emoji: "🥉", min: 0, feeDiscountBps: 0, perks: ["Acceso a misiones diarias"] },
  { key: "contributor", label: "Contributor", emoji: "🥈", min: 400, feeDiscountBps: 5, perks: ["-0.05% comisión", "Insignia en el perfil"] },
  { key: "ambassador", label: "Ambassador", emoji: "🥇", min: 1500, feeDiscountBps: 10, perks: ["-0.10% comisión", "Mayor visibilidad del perfil"] },
  { key: "elite", label: "Elite", emoji: "💎", min: 4000, feeDiscountBps: 15, perks: ["-0.15% comisión", "Acceso anticipado a lanzamientos"] },
  { key: "legend", label: "Legend", emoji: "👑", min: 10000, feeDiscountBps: 25, perks: ["-0.25% comisión", "Recompensas exclusivas", "Campañas destacadas"] },
];

export function levelFor(xp: number): LevelSpec {
  let current = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.min) current = l;
  return current;
}

export function nextLevel(xp: number): LevelSpec | null {
  return LEVELS.find((l) => l.min > xp) ?? null;
}

export function levelProgress(xp: number): number {
  const cur = levelFor(xp);
  const next = nextLevel(xp);
  if (!next) return 100;
  return Math.min(100, Math.round(((xp - cur.min) / (next.min - cur.min)) * 100));
}

export const CAMPAIGN_DURATIONS = [
  { hours: 24, label: "24 horas" },
  { hours: 72, label: "3 días" },
  { hours: 168, label: "7 días" },
];

export const REWARD_CURRENCIES = [
  { value: "token", label: "Token del proyecto" },
  { value: "labsbnb", label: "LabsBNB" },
  { value: "bnb", label: "BNB" },
  { value: "nft", label: "NFT" },
  { value: "raffle", label: "Entradas a sorteo" },
  { value: "fee_discount", label: "Descuento en comisiones" },
];
