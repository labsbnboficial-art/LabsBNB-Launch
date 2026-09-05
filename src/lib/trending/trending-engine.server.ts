// 🔥 LabsBNB Trending Engine — server-side, deterministic, real data only.
//
// Pipeline per run:
//   1. single-flight lock (`admin_config`)                → no parallel runs
//   2. factory listing (`allTokens`)                      → active tokens
//   3. decoded `Trade(...)` logs per bonding curve        → temporal windows
//   4. pure scoring (`trending-score.ts`)                 → score + velocity
//   5. snapshot insert + in-process cache                 → fast reads
//
// Nothing is simulated: when a metric cannot be read on-chain it stays `null`
// and its weight is redistributed over the metrics that ARE available.
import { fetchFactoryTokens, type FactoryToken } from "@/lib/web3/onchain-token";
import { fetchTradeEvents } from "@/lib/web3/curve-events";
import { tokenMediaUrl } from "@/lib/media-url";
import { withRpcTimeout } from "@/lib/web3/timeout";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  acquireTrendingLock,
  loadTrendingConfig,
  releaseTrendingLock,
  saveTrendingState,
} from "./trending-config.server";
import { previousHolders, saveSnapshots, type SnapshotRow } from "./trending-store.server";
import { computeBadges, computeMetrics, computeTrendingScore, explainTrending } from "./trending-score";
import {
  TREND_WINDOWS,
  type TrendingConfig,
  type TrendingEngineState,
  type TrendingRow,
  type WindowId,
} from "./trending-types";

const TOKEN_TIMEOUT_MS = 20_000;
const CONCURRENCY = 3;

/** Last successful ranking, kept per worker instance so reads stay instant. */
let memoryCache: { at: number; rows: TrendingRow[] } | null = null;
export const CACHE_TTL_MS = 90_000;

export function cachedRanking(maxAgeMs = CACHE_TTL_MS): TrendingRow[] | null {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.at > maxAgeMs) return null;
  return memoryCache.rows;
}

const wei = (v: string | null | undefined) => (v == null ? null : Number(v) / 1e18);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

type Computed = { row: TrendingRow; snapshot: SnapshotRow } | { error: string };

async function scoreToken(
  token: FactoryToken,
  cfg: TrendingConfig,
  prevHolders: Map<string, number>,
  now: number,
): Promise<Computed> {
  try {
    const events = token.curve
      ? await withRpcTimeout(`trending ${token.ticker}`, () => fetchTradeEvents(token.curve!), TOKEN_TIMEOUT_MS)
      : [];

    const m = token.metrics;
    const progress = m ? Math.min(100, m.progressBps / 100) : null;
    const target = m ? wei(m.targetBnbWei) : null;
    const raised = m ? wei(m.liquidityWei) : null;

    const metrics = computeMetrics({
      events,
      now,
      holders: m ? m.holders : null,
      previousHolders: prevHolders.get(token.address.toLowerCase()) ?? null,
      bondingProgress: progress,
      whaleBnb: cfg.whale_bnb,
    });

    const { score, parts } = computeTrendingScore(metrics, cfg.weights, now);
    const badges = computeBadges(metrics, score, cfg);
    const volumes = {} as Record<WindowId, number>;
    for (const id of TREND_WINDOWS) volumes[id] = metrics.windows[id].volume;

    const w15 = metrics.windows["15m"];
    const w5 = metrics.windows["5m"];
    const w1h = metrics.windows["1h"];
    const updatedAt = new Date(now * 1000).toISOString();

    const row: TrendingRow = {
      address: token.address,
      curve: token.curve,
      name: token.name,
      symbol: token.ticker,
      logo: tokenMediaUrl(token.metadataURI),
      price: m ? String(wei(m.priceWei)) : null,
      priceChange24h: m ? m.priceChangeBps / 100 : null,
      volume: metrics.windows["24h"].volume,
      volumes,
      trades: metrics.windows["24h"].trades,
      buyers: w1h.buyers,
      sellers: w1h.sellers,
      holders: m ? m.holders : null,
      bondingProgress: progress,
      bondingRemaining:
        target != null && raised != null ? String(Math.max(0, target - raised)) : null,
      graduated: progress != null && progress >= 100,
      trendingScore: score,
      velocityScore: metrics.velocityPct,
      organicScore: metrics.organicScore,
      whaleTrades: w1h.whaleTrades,
      parts,
      badges,
      reason: explainTrending(metrics),
      lastTradeAt: metrics.lastTradeAt ? new Date(metrics.lastTradeAt * 1000).toISOString() : null,
      rank: 0,
      updatedAt,
    };

    const snapshot: SnapshotRow = {
      token_address: token.address.toLowerCase(),
      chain_id: ACTIVE_CHAIN_ID,
      timestamp: updatedAt,
      volume_5m: volumes["5m"],
      volume_15m: volumes["15m"],
      volume_1h: volumes["1h"],
      volume_6h: volumes["6h"],
      volume_24h: volumes["24h"],
      trades_5m: w5.trades,
      trades_15m: w15.trades,
      buyers_5m: w5.buyers,
      buyers_15m: w15.buyers,
      sellers_5m: w5.sellers,
      sellers_15m: w15.sellers,
      holders: row.holders,
      bonding_progress: progress,
      whale_score: w1h.whaleTrades,
      trending_score: score,
      velocity_score: metrics.velocityPct,
      payload: row,
    };

    return { row, snapshot };
  } catch (e) {
    return { error: `${token.ticker}: ${e instanceof Error ? e.message : "read failed"}` };
  }
}

export type TrendingRunResult = {
  ok: boolean;
  skipped?: "locked" | "disabled";
  rows: TrendingRow[];
  state: TrendingEngineState;
};

/** Runs one full scan. Safe to call from the cron endpoint or the admin panel. */
export async function runTrendingEngine(trigger: string): Promise<TrendingRunResult> {
  const started = Date.now();
  const cfg = await loadTrendingConfig();
  const notes: string[] = [];

  if (!cfg.engine_enabled) {
    notes.push("Engine disabled from the admin panel.");
    return { ok: false, skipped: "disabled", rows: cachedRanking(Infinity) ?? [], state: { ...(await emptyState(trigger)), notes } };
  }

  const lock = await acquireTrendingLock(trigger);
  if (!lock.acquired) {
    notes.push(`Another run is in progress (since ${lock.heldSince ?? "unknown"}).`);
    return { ok: false, skipped: "locked", rows: cachedRanking(Infinity) ?? [], state: { ...(await emptyState(trigger)), notes } };
  }

  let errors = 0;
  let lastError: string | null = null;
  let scanned = 0;
  let rows: TrendingRow[] = [];
  let excluded = 0;

  try {
    const tokens = await fetchFactoryTokens(cfg.scan_tokens);
    scanned = tokens.length;
    const prev = await previousHolders(ACTIVE_CHAIN_ID);
    const now = Math.floor(Date.now() / 1000);

    const results = await mapLimit(tokens, CONCURRENCY, (t) => scoreToken(t, cfg, prev, now));
    const snapshots: SnapshotRow[] = [];
    for (const r of results) {
      if ("error" in r) {
        errors += 1;
        lastError = r.error;
        continue;
      }
      if (cfg.min_trades_24h > 0 && r.row.trades < cfg.min_trades_24h) {
        excluded += 1;
        continue;
      }
      snapshots.push(r.snapshot);
      rows.push(r.row);
    }

    rows = rows
      .sort((a, b) => b.trendingScore - a.trendingScore || b.volumes["1h"] - a.volumes["1h"])
      .map((r, i) => ({ ...r, rank: i + 1 }));
    memoryCache = { at: Date.now(), rows };

    const saved = await saveSnapshots(
      snapshots.map((s) => ({ ...s, payload: rows.find((r) => r.address === s.payload.address) ?? s.payload })),
    );
    if (saved.error) notes.push(`Snapshots not stored: ${saved.error}`);
  } catch (e) {
    errors += 1;
    lastError = e instanceof Error ? e.message : "engine failure";
  } finally {
    await releaseTrendingLock(lock.token);
  }

  const durationMs = Date.now() - started;
  const state: TrendingEngineState = {
    lastRunAt: new Date().toISOString(),
    lastSuccessAt: errors === 0 ? new Date().toISOString() : (await lastSuccess()),
    lastTrigger: trigger,
    tokensScanned: scanned,
    tokensRanked: rows.length,
    tokensExcluded: excluded,
    durationMs,
    errors,
    lastError,
    notes,
  };
  await saveTrendingState(state);

  console.info(
    `[TRENDING_ENGINE] completed | trigger=${trigger} | tokens scanned=${scanned} | tokens ranked=${rows.length} | tokens excluded=${excluded} | duration=${durationMs}ms | errors=${errors}${lastError ? ` | last error=${lastError}` : ""}`,
  );

  return { ok: errors === 0, rows, state };
}

async function lastSuccess(): Promise<string | null> {
  const { loadTrendingState } = await import("./trending-config.server");
  return (await loadTrendingState()).lastSuccessAt;
}

async function emptyState(trigger: string): Promise<TrendingEngineState> {
  const { loadTrendingState } = await import("./trending-config.server");
  const s = await loadTrendingState();
  return { ...s, lastTrigger: trigger };
}

/**
 * Ranking for the UI. Order of preference:
 *   in-process cache → stored snapshots → inline run (bounded).
 * Never blocks the page on a full chain scan when fresh data already exists.
 */
export async function getRanking(): Promise<{ rows: TrendingRow[]; source: "cache" | "snapshots" | "live" }> {
  const cached = cachedRanking();
  if (cached?.length) return { rows: cached, source: "cache" };

  const { latestRanking } = await import("./trending-store.server");
  const stored = await latestRanking(ACTIVE_CHAIN_ID);
  if (stored.length) {
    memoryCache = { at: Date.now(), rows: stored };
    return { rows: stored, source: "snapshots" };
  }

  const run = await runTrendingEngine("on-demand");
  return { rows: run.rows, source: "live" };
}
