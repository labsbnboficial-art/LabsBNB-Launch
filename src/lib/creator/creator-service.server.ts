// Creator system — aggregation service (server only, cached).
//
// Source of truth:
//   • Factory `creatorOf(token)`            → creator identity (on-chain)
//   • Trending Engine ranking               → real per-token metrics
//   • `trending_snapshots`                  → historical trending facts
//   • `tokens` table                        → launch / graduation dates
//
// Nothing is recomputed per page view: the whole creator index is built once
// and cached in-process, so a creator with many tokens still loads instantly.
import type { Abi } from "viem";
import { readClient, isAddress } from "@/lib/web3/onchain-token";
import { FACTORY_ABI } from "@/lib/web3/abis";
import { DEFAULT_CONFIG } from "@/lib/launchpad-config";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import type { TrendingRow } from "@/lib/trending/trending-types";
import {
  aggregateStats,
  buildCreatorToken,
  buildTimeline,
  computeCreatorBadges,
  computeCreatorScore,
  normalizeCreatorAddress,
  pickBestPerformer,
  sortCreatorTokens,
} from "./creator-score";
import {
  EMPTY_CUSTOMIZATION,
  EMPTY_HISTORY,
  type CreatorLeaderboardRow,
  type CreatorProfile,
  type TokenTrendingHistory,
} from "./creator-types";
import { loadCustomizations, loadTokenDbInfo, loadTrendingHistory } from "./creator-store.server";

const CACHE_TTL_MS = 300_000; // 5 min
let cache: { at: number; profiles: CreatorProfile[]; source: string } | null = null;

/** On-chain creator resolution for tokens whose ranking row predates the field. */
const creatorCache = new Map<string, string | null>();

async function resolveCreators(addresses: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const factory = DEFAULT_CONFIG.factory_address as `0x${string}` | null;
  const missing: string[] = [];
  for (const a of addresses) {
    const key = a.toLowerCase();
    if (creatorCache.has(key)) out.set(key, creatorCache.get(key) ?? null);
    else missing.push(a);
  }
  if (!missing.length || !factory || !isAddress(factory)) return out;
  const client = readClient();
  await Promise.all(
    missing.map(async (address) => {
      const key = address.toLowerCase();
      try {
        const raw = (await client.readContract({
          address: factory,
          abi: FACTORY_ABI as Abi,
          functionName: "creatorOf",
          args: [address as `0x${string}`],
        })) as string;
        const creator = normalizeCreatorAddress(raw);
        creatorCache.set(key, creator);
        out.set(key, creator);
      } catch {
        out.set(key, null);
      }
    }),
  );
  return out;
}

async function buildIndex(): Promise<{ profiles: CreatorProfile[]; source: string }> {
  const engine = await import("@/lib/trending/trending-engine.server");
  const { rows, source } = await engine.getRanking();

  const withCreator = rows.filter((r) => normalizeCreatorAddress(r.creator));
  const needsLookup = rows.filter((r) => !normalizeCreatorAddress(r.creator)).map((r) => r.address);
  const resolved = await resolveCreators(needsLookup);

  const byCreator = new Map<string, TrendingRow[]>();
  const add = (creator: string, row: TrendingRow) => {
    const list = byCreator.get(creator) ?? [];
    list.push(row);
    byCreator.set(creator, list);
  };
  for (const r of withCreator) add(normalizeCreatorAddress(r.creator)!, r);
  for (const r of rows) {
    if (normalizeCreatorAddress(r.creator)) continue;
    const c = resolved.get(r.address.toLowerCase());
    if (c) add(c, r);
  }

  const addresses = rows.map((r) => r.address.toLowerCase());
  const [history, dbInfo, customizations] = await Promise.all([
    loadTrendingHistory(ACTIVE_CHAIN_ID),
    loadTokenDbInfo(ACTIVE_CHAIN_ID, addresses),
    loadCustomizations(ACTIVE_CHAIN_ID, [...byCreator.keys()]),
  ]);

  const updatedAt = new Date().toISOString();
  const profiles: CreatorProfile[] = [];
  for (const [creator, list] of byCreator) {
    const tokens = sortCreatorTokens(
      list.map((row) =>
        buildCreatorToken(
          row,
          history.get(row.address.toLowerCase()) ?? EMPTY_HISTORY,
          dbInfo.get(row.address.toLowerCase()) ?? { createdAt: null, graduatedAt: null },
        ),
      ),
    );
    const scoped: Map<string, TokenTrendingHistory> = new Map(
      tokens.map((t) => [t.address.toLowerCase(), history.get(t.address.toLowerCase()) ?? EMPTY_HISTORY]),
    );
    const stats = aggregateStats(tokens, scoped);
    const { score, parts } = computeCreatorScore(stats, tokens);
    profiles.push({
      address: creator,
      chainId: ACTIVE_CHAIN_ID,
      score,
      parts,
      badges: computeCreatorBadges(stats, tokens),
      stats,
      tokens,
      bestPerformer: pickBestPerformer(tokens),
      timeline: buildTimeline(tokens, scoped),
      customization: customizations.get(creator) ?? EMPTY_CUSTOMIZATION,
      updatedAt,
    });
  }

  profiles.sort(
    (a, b) =>
      b.score - a.score ||
      b.stats.graduatedTokens - a.stats.graduatedTokens ||
      b.stats.organicVolume24h - a.stats.organicVolume24h,
  );
  return { profiles, source };
}

async function index(): Promise<{ profiles: CreatorProfile[]; source: string }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { profiles: cache.profiles, source: "cache" };
  const built = await buildIndex();
  cache = { at: Date.now(), ...built };
  return built;
}

/** Full creator index (used by the Creator Points Engine). Read-only. */
export async function getCreatorIndex(): Promise<{ profiles: CreatorProfile[]; source: string }> {
  return index();
}

export async function getCreatorProfile(
  addressInput: string,
): Promise<{ profile: CreatorProfile | null; source: string }> {
  const address = normalizeCreatorAddress(addressInput);
  if (!address) return { profile: null, source: "invalid" };
  const { profiles, source } = await index();
  return { profile: profiles.find((p) => p.address === address) ?? null, source };
}

export type LeaderboardSort = "score" | "graduations" | "volume" | "trending";

export async function getCreatorLeaderboard(
  sort: LeaderboardSort = "score",
  limit = 50,
): Promise<{ creators: CreatorLeaderboardRow[]; total: number; source: string }> {
  const { profiles, source } = await index();
  const sorted = [...profiles].sort((a, b) => {
    switch (sort) {
      case "graduations":
        return b.stats.graduatedTokens - a.stats.graduatedTokens || b.score - a.score;
      case "volume":
        return b.stats.organicVolume24h - a.stats.organicVolume24h || b.score - a.score;
      case "trending":
        return (
          (a.stats.bestTrendingRank ?? Infinity) - (b.stats.bestTrendingRank ?? Infinity) || b.score - a.score
        );
      default:
        return b.score - a.score;
    }
  });
  const creators = sorted.slice(0, limit).map((p, i) => ({
    address: p.address,
    displayName: p.customization.displayName,
    avatarUrl: p.customization.avatarUrl,
    score: p.score,
    tokensCreated: p.stats.tokensCreated,
    graduatedTokens: p.stats.graduatedTokens,
    organicVolume24h: p.stats.organicVolume24h,
    bestTrendingRank: p.stats.bestTrendingRank,
    badges: p.badges,
    rank: i + 1,
  }));
  return { creators, total: profiles.length, source };
}

/** Test/ops helper: drops the in-process cache. */
export function resetCreatorCache() {
  cache = null;
  creatorCache.clear();
}
