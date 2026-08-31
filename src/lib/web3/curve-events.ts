// Reads Trade(...) events + live views straight from the BondingCurve contract.
// Everything on this page comes from the chain — no database, no simulation.
//
// IMPORTANT: most public BSC-Testnet RPCs reject `eth_getLogs` outright
// ("limit exceeded", "Archive requests require a personal token", ...).
// We therefore probe a list of endpoints and stick to the first one that
// actually returns logs, and we surface the real RPC error instead of
// silently returning an empty list.
import { getAbiItem, type Abi, type AbiEvent, type Log } from "viem";
import { readClient } from "./onchain-token";
import { CURVE_ABI } from "./abis";
import { getLogsChunked } from "./log-range";

/** Event definition taken from the deployed contract ABI (never hand-written). */
export const TRADE_EVENT = getAbiItem({ abi: CURVE_ABI as Abi, name: "Trade" }) as AbiEvent;

export type TradeEvent = {
  key: string;
  txHash: string;
  trader: `0x${string}`;
  isBuy: boolean;
  amountBnb: bigint;
  amountTokens: bigint;
  price: bigint;
  marketCap: bigint;
  timestamp: number; // seconds
  blockNumber: bigint;
};

// Grid used for the in-memory cache. Each grid range is internally split by
// `getLogsChunked` into windows the public RPCs accept, so this value is a
// cache granularity, never a raw `eth_getLogs` range.
const CHUNK = 3_000n;
const MAX_LOOKBACK = 600_000n; // ~21 days on BSC (3s blocks)
const MAX_CHUNKS_PER_PAGE = 36; // bounds latency once the page already has trades
// A curve can be idle for days: keep scanning further back while nothing was
// found yet, otherwise the very first page returns empty and the UI stops.
const MAX_EMPTY_CHUNKS_PER_PAGE = 108;
// Keep log ranges sequential. Free Mainnet providers aggressively throttle
// concurrent eth_getLogs calls, which otherwise turns intermittent failures
// into a complete chart/trades outage.
const PARALLEL_CHUNKS = 1;
const HEAD_MARGIN = 6n; // blocks near the head are not cached (may still reorg)


/**
 * Runs one grid range through the safe chunked reader: the range is split into
 * small windows the public BSC-Testnet RPCs actually accept, merged, deduped
 * and sorted. Throws the real RPC error when a window cannot be read at all.
 */
async function getLogsRange(curve: `0x${string}`, from: bigint, to: bigint) {
  return getLogsChunked({ address: curve, event: TRADE_EVENT, from, to, label: `Trade ${curve.slice(0, 10)}` });
}


function decode(logs: Log[]): TradeEvent[] {
  const out: TradeEvent[] = [];
  for (const log of logs) {
    const a = (log as Log & { args?: Record<string, unknown> }).args as {

      trader?: `0x${string}`;
      isBuy?: boolean;
      amountBnb?: bigint;
      amountTokens?: bigint;
      price?: bigint;
      marketCap?: bigint;
      timestamp?: bigint;
    };
    if (!a.trader) continue;
    out.push({
      key: `${log.transactionHash}-${log.logIndex}`,
      txHash: log.transactionHash!,
      trader: a.trader,
      isBuy: Boolean(a.isBuy),
      amountBnb: a.amountBnb ?? 0n,
      amountTokens: a.amountTokens ?? 0n,
      price: a.price ?? 0n,
      marketCap: a.marketCap ?? 0n,
      timestamp: Number(a.timestamp ?? 0n),
      blockNumber: log.blockNumber!,
    });
  }
  return out;
}

/* ---------------------------- block-range cache ---------------------------- */
// Block ranges are aligned to a fixed CHUNK grid so the very same range is
// requested every time (any timeframe, any page). Finalised chunks are cached
// in memory, which makes switching timeframes instant and consistent: the
// chart and the trades table always read the exact same event set.

const chunkCache = new Map<string, TradeEvent[]>();
const inflight = new Map<string, Promise<TradeEvent[]>>();

/** Reads (and caches) one grid-aligned chunk of Trade events. */
async function getChunk(curve: `0x${string}`, index: number, head: bigint): Promise<TradeEvent[]> {
  const from = BigInt(index) * CHUNK;
  const to = from + CHUNK - 1n;
  const key = `${curve.toLowerCase()}:${index}`;
  const finalised = to < head - HEAD_MARGIN;

  const cached = chunkCache.get(key);
  if (finalised && cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const logs = await getLogsRange(curve, from, to > head ? head : to);
    const events = decode(logs);
    if (finalised) chunkCache.set(key, events);
    return events;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** Drops cached ranges for a curve (used after a trade to force a fresh read). */
export function invalidateTradeCache(curve?: `0x${string}`) {
  if (!curve) return chunkCache.clear();
  const prefix = `${curve.toLowerCase()}:`;
  for (const k of [...chunkCache.keys()]) if (k.startsWith(prefix)) chunkCache.delete(k);
}

export type TradePage = {
  events: TradeEvent[]; // oldest → newest inside the page
  /** Chunk index to continue from (scanning backwards); null when history ends. */
  nextCursor: string | null;
  scannedFrom: string;
  scannedTo: string;
};

/**
 * Paginated history: scans backwards from `cursor` (a grid chunk index) or the
 * chain head, collecting `pageSize` trades at most, bounded by the lookback
 * window and the per-page chunk budget. Cached chunks resolve instantly.
 */
export async function fetchTradePage(
  curve: `0x${string}`,
  cursor?: string | null,
  pageSize = 25,
): Promise<TradePage> {
  const head = await readClient().getBlockNumber();
  const headIndex = Number(head / CHUNK);
  const floorBlock = head > MAX_LOOKBACK ? head - MAX_LOOKBACK : 0n;
  const floorIndex = Number(floorBlock / CHUNK);

  let index = cursor != null ? Number(cursor) : headIndex;
  if (!Number.isFinite(index) || index > headIndex) index = headIndex;

  const collected: TradeEvent[] = [];
  let chunks = 0;

  const budget = () => (collected.length ? MAX_CHUNKS_PER_PAGE : MAX_EMPTY_CHUNKS_PER_PAGE);

  while (index >= floorIndex && collected.length < pageSize && chunks < budget()) {
    // Fetch a small batch of consecutive chunks in parallel to keep latency low
    // even when the last trades happened days ago.
    const batch: number[] = [];
    for (let i = 0; i < PARALLEL_CHUNKS && index - i >= floorIndex && chunks + i < budget(); i += 1) {
      batch.push(index - i);
    }
    const results = await Promise.all(batch.map((i) => getChunk(curve, i, head)));
    results.flat().forEach((e) => collected.push(e)); // ordered by the sort below

    chunks += batch.length;
    index -= batch.length;
  }


  collected.sort((x, y) => (x.blockNumber === y.blockNumber ? 0 : x.blockNumber < y.blockNumber ? -1 : 1));

  return {
    events: collected,
    nextCursor: index >= floorIndex ? String(index) : null,
    scannedFrom: (BigInt(index + 1) * CHUNK).toString(),
    scannedTo: head.toString(),
  };
}


/** Convenience wrapper: first page only (used by charts / counters). */
export async function fetchTradeEvents(curve: `0x${string}`): Promise<TradeEvent[]> {
  const page = await fetchTradePage(curve, null, 200);
  return page.events;
}

/* -------------------------------- candles --------------------------------- */

export const TIMEFRAMES = [
  { id: "1m", label: "1m", seconds: 60 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "15m", label: "15m", seconds: 900 },
  { id: "30m", label: "30m", seconds: 1800 },
  { id: "1h", label: "1H", seconds: 3600 },
  { id: "4h", label: "4H", seconds: 14400 },
  { id: "1d", label: "1D", seconds: 86400 },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export type Candle = {
  time: number; // bucket start, ms
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // BNB
  trades: number;
};

/** Aggregates Trade events into OHLC candles for the requested timeframe. */
export function buildCandles(events: TradeEvent[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  for (const e of sorted) {
    const price = Number(e.price) / 1e18;
    if (!Number.isFinite(price) || price <= 0) continue;
    const start = Math.floor(e.timestamp / seconds) * seconds;
    const cur = buckets.get(start);
    const vol = Number(e.amountBnb) / 1e18;
    if (!cur) {
      buckets.set(start, {
        time: start * 1000,
        label: formatBucket(start * 1000, seconds),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol,
        trades: 1,
      });
    } else {
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
      cur.volume += vol;
      cur.trades += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function formatBucket(ms: number, seconds: number): string {
  const d = new Date(ms);
  if (seconds >= 86400) return d.toLocaleDateString([], { month: "short", day: "2-digit" });
  if (seconds >= 3600) return d.toLocaleString([], { day: "2-digit", hour: "2-digit" });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* --------------------------------- views ---------------------------------- */

export type CurveStats = {
  volume24hWei: bigint;
  priceChangeBps: bigint; // int256, basis points from the contract
  holders: number;
  currentPriceWei: bigint;
};

/** Reads the contract's own analytics views (volume24h / priceChange / holders). */
export async function fetchCurveStats(curve: `0x${string}`): Promise<CurveStats> {
  const client = readClient();
  const safe = async <T>(p: Promise<unknown>, fallback: T): Promise<T> => {
    try { return (await p) as T; } catch { return fallback; }
  };
  const [vol, change, holders, price] = await Promise.all([
    safe<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "volume24h" }), 0n),
    safe<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "priceChange" }), 0n),
    safe<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "holders" }), 0n),
    safe<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "currentPrice" }), 0n),
  ]);
  return { volume24hWei: vol, priceChangeBps: change, holders: Number(holders), currentPriceWei: price };
}
