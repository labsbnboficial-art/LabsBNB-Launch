// 🏆 Creator Points — PURE rules (no I/O, fully deterministic, unit tested).
//
// Everything here is a function of real inputs: decoded `Trade(...)` events,
// holders read on-chain, stored trending history and the admin configuration.
// No randomness, no clocks other than the explicit `now` argument.
import type { TradeEvent } from "@/lib/web3/curve-events";
import type { CreatorPointsConfig, PointsEventType } from "./points-types";

/* ------------------------------- addresses -------------------------------- */

export function lower(address: string | null | undefined): string {
  return typeof address === "string" ? address.toLowerCase() : "";
}

/* ------------------------------- fingerprint ------------------------------ */

/**
 * Deterministic idempotency key:
 *   sha256(chain_id | creator | event_type | source_id | token_address)
 *
 * The ledger has UNIQUE(fingerprint), so running the cron 100 times over the
 * same data can only ever insert the event once.
 */
export function fingerprintInput(parts: {
  chainId: number;
  creatorAddress: string;
  eventType: PointsEventType;
  sourceId: string;
  tokenAddress: string | null;
}): string {
  return [
    String(parts.chainId),
    lower(parts.creatorAddress),
    parts.eventType,
    String(parts.sourceId).toLowerCase(),
    lower(parts.tokenAddress) || "-",
  ].join("|");
}

export async function fingerprint(parts: Parameters<typeof fingerprintInput>[0]): Promise<string> {
  const input = fingerprintInput(parts);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------- multiplier ------------------------------- */

/**
 * Organic Activity multiplier — reuses the Organic Activity Score already
 * computed by the Trending Engine (0..100). Below 30 the activity is not
 * considered organic enough and the event awards ZERO points.
 */
export function organicMultiplier(organicScore: number | null | undefined): number {
  if (organicScore == null || !Number.isFinite(organicScore)) return 0;
  const s = Math.max(0, Math.min(100, organicScore));
  if (s < 30) return 0;
  if (s < 50) return 0.5;
  if (s < 70) return 0.75;
  if (s < 85) return 1;
  if (s < 95) return 1.1;
  return 1.25;
}

export function applyMultiplier(basePoints: number, multiplier: number): number {
  if (!Number.isFinite(basePoints) || basePoints <= 0) return 0;
  return Math.max(0, Math.floor(basePoints * multiplier));
}

/* ------------------------------- milestones ------------------------------- */

export type MilestoneHit = { index: number; threshold: number; points: number };

/** Every ascending threshold reached by `value`, with its configured points. */
export function milestonesReached(
  thresholds: number[],
  points: number[],
  value: number | null | undefined,
): MilestoneHit[] {
  if (value == null || !Number.isFinite(value)) return [];
  const hits: MilestoneHit[] = [];
  thresholds.forEach((threshold, index) => {
    if (value >= threshold) hits.push({ index, threshold, points: points[index] ?? 0 });
  });
  return hits;
}

/* --------------------------- trade aggregation ---------------------------- */

export type TradeAggregate = {
  trades: number;
  /** Unique buyer wallets, EXCLUDING the creator wallet. */
  uniqueBuyers: number;
  uniqueTraders: number;
  /** Volume in BNB excluding creator self-trading and round-trip (wash) volume. */
  organicVolume: number;
  /** Raw volume in BNB (kept only for observability/metadata). */
  rawVolume: number;
  /** Volume traded by the creator wallet on its own token. */
  selfVolume: number;
  selfTrades: number;
  topWalletShare: number;
  roundTripShare: number;
  suspicious: boolean;
  suspicionReason: string | null;
};

const bnb = (wei: bigint) => Number(wei) / 1e18;

/**
 * Aggregates the real trade stream of one token for Creator Points purposes.
 *
 * Anti-farming applied here (deterministic and explainable):
 *   • creator self-trading is removed from volume and buyer counts
 *   • wallets that both buy AND sell (round-trips) do not count as volume
 *   • wallet diversity is measured, never transaction count
 */
export function aggregateTrades(events: TradeEvent[], creatorAddress: string): TradeAggregate {
  const creator = lower(creatorAddress);
  const buyers = new Set<string>();
  const perWallet = new Map<string, { volume: number; buys: number; sells: number }>();
  let rawVolume = 0;
  let selfVolume = 0;
  let selfTrades = 0;

  for (const e of events) {
    const wallet = lower(e.trader);
    const amount = bnb(e.amountBnb);
    rawVolume += amount;
    if (wallet === creator) {
      selfVolume += amount;
      selfTrades += 1;
      continue; // creator activity never generates Creator Points
    }
    if (e.isBuy) buyers.add(wallet);
    const cur = perWallet.get(wallet) ?? { volume: 0, buys: 0, sells: 0 };
    cur.volume += amount;
    if (e.isBuy) cur.buys += 1;
    else cur.sells += 1;
    perWallet.set(wallet, cur);
  }

  let externalVolume = 0;
  let roundTripVolume = 0;
  let topVolume = 0;
  for (const w of perWallet.values()) {
    externalVolume += w.volume;
    if (w.volume > topVolume) topVolume = w.volume;
    if (w.buys > 0 && w.sells > 0) roundTripVolume += w.volume;
  }

  const organicVolume = Math.max(0, externalVolume - roundTripVolume);
  const topWalletShare = externalVolume > 0 ? topVolume / externalVolume : 0;
  const roundTripShare = externalVolume > 0 ? roundTripVolume / externalVolume : 0;

  let suspicionReason: string | null = null;
  if (perWallet.size > 0 && roundTripShare >= 0.6) {
    suspicionReason = "Circular trading: la mayoría del volumen proviene de wallets que compran y venden.";
  } else if (perWallet.size > 0 && perWallet.size < 3 && topWalletShare >= 0.8) {
    suspicionReason = "Volumen concentrado en una sola wallet.";
  }

  return {
    trades: events.length - selfTrades,
    uniqueBuyers: buyers.size,
    uniqueTraders: perWallet.size,
    organicVolume,
    rawVolume,
    selfVolume,
    selfTrades,
    topWalletShare,
    roundTripShare,
    suspicious: suspicionReason != null,
    suspicionReason,
  };
}

/* -------------------------------- reasons --------------------------------- */

export function milestoneReason(eventType: PointsEventType, threshold: number): string {
  switch (eventType) {
    case "UNIQUE_BUYER_MILESTONE":
      return `Reached ${threshold} unique buyers`;
    case "HOLDER_MILESTONE":
      return `Reached ${threshold} holders`;
    case "ORGANIC_VOLUME_MILESTONE":
      return `Reached ${threshold} BNB of organic volume`;
    default:
      return `Reached milestone ${threshold}`;
  }
}

export const EVENT_REASON: Record<PointsEventType, string> = {
  TOKEN_CREATED: "Created a new token",
  UNIQUE_BUYER_MILESTONE: "Unique buyers milestone",
  HOLDER_MILESTONE: "Holders milestone",
  ORGANIC_VOLUME_MILESTONE: "Organic volume milestone",
  TRENDING_TOP10: "Entered Trending Top 10",
  TRENDING_TOP5: "Entered Trending Top 5",
  RISING_FAST: "Detected as Rising Fast",
  NEAR_GRADUATION: "Reached Near Graduation",
  GRADUATED: "Token graduated",
  COMMUNITY_MILESTONE: "Built a real community around the token",
  ADMIN_ADJUSTMENT: "Administrative adjustment",
};

/* ------------------------------ configuration ----------------------------- */

export class PointsConfigError extends Error {}

function num(label: string, value: unknown, min: number, max: number, integer = true): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new PointsConfigError(`${label}: valor inválido.`);
  if (n < min || n > max) throw new PointsConfigError(`${label}: debe estar entre ${min} y ${max}.`);
  if (integer && !Number.isInteger(n)) throw new PointsConfigError(`${label}: debe ser entero.`);
  return n;
}

function ascending(label: string, value: unknown, fallback: number[], max: number): number[] {
  const arr = Array.isArray(value) ? value : fallback;
  if (arr.length !== fallback.length) {
    throw new PointsConfigError(`${label}: se esperan ${fallback.length} valores.`);
  }
  const parsed = arr.map((v, i) => num(`${label}[${i}]`, v, 0, max, false));
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i]! <= parsed[i - 1]!) throw new PointsConfigError(`${label}: debe ser estrictamente ascendente.`);
  }
  return parsed;
}

/** Server-side validation. Frontend input is never trusted. */
export function validatePointsConfig(
  input: unknown,
  current: CreatorPointsConfig,
): CreatorPointsConfig {
  const raw = (input ?? {}) as Partial<CreatorPointsConfig>;
  const pick = <K extends keyof CreatorPointsConfig>(k: K): unknown => (raw[k] === undefined ? current[k] : raw[k]);

  const events = {} as CreatorPointsConfig["events"];
  for (const key of Object.keys(current.events) as PointsEventType[]) {
    const cur = current.events[key];
    const incoming = (raw.events?.[key] ?? {}) as Partial<typeof cur>;
    events[key] = {
      enabled: Boolean(incoming.enabled ?? cur.enabled),
      base_points: num(`${key}.base_points`, incoming.base_points ?? cur.base_points, 0, 1_000_000),
      daily_cap: num(`${key}.daily_cap`, incoming.daily_cap ?? cur.daily_cap, 0, 10_000_000),
      one_time: Boolean(incoming.one_time ?? cur.one_time),
      apply_multiplier: Boolean(incoming.apply_multiplier ?? cur.apply_multiplier),
      minimum_activity: num(`${key}.minimum_activity`, incoming.minimum_activity ?? cur.minimum_activity, 0, 10_000),
    };
  }

  return {
    engine_enabled: Boolean(pick("engine_enabled")),
    scan_interval_min: num("scan_interval_min", pick("scan_interval_min"), 1, 60),
    max_token_creations_per_day: num("max_token_creations_per_day", pick("max_token_creations_per_day"), 0, 50),
    lookback_days: num("lookback_days", pick("lookback_days"), 1, 30),
    buyer_milestones: ascending("buyer_milestones", pick("buyer_milestones"), current.buyer_milestones, 1_000_000),
    holder_milestones: ascending("holder_milestones", pick("holder_milestones"), current.holder_milestones, 1_000_000),
    volume_milestones: ascending("volume_milestones", pick("volume_milestones"), current.volume_milestones, 1_000_000),
    milestone_points: (Array.isArray(pick("milestone_points")) ? (pick("milestone_points") as number[]) : current.milestone_points).map(
      (v, i) => num(`milestone_points[${i}]`, v, 0, 1_000_000),
    ),
    community_min_holders: num("community_min_holders", pick("community_min_holders"), 1, 1_000_000),
    community_min_buyers: num("community_min_buyers", pick("community_min_buyers"), 1, 1_000_000),
    events,
  };
}

/** UTC day key used by the daily caps (deterministic, timezone independent). */
export function utcDayKey(iso: string | number | Date): string {
  return new Date(iso).toISOString().slice(0, 10);
}
