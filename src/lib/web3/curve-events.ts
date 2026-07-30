// Reads Trade(...) events + live views straight from the BondingCurve contract.
// Everything on this page comes from the chain — no database, no simulation.
//
// IMPORTANT: most public BSC-Testnet RPCs reject `eth_getLogs` outright
// ("limit exceeded", "Archive requests require a personal token", ...).
// We therefore probe a list of endpoints and stick to the first one that
// actually returns logs, and we surface the real RPC error instead of
// silently returning an empty list.
import { createPublicClient, http, getAbiItem, type Abi, type AbiEvent, type PublicClient } from "viem";
import { bscTestnet } from "wagmi/chains";
import { readClient } from "./onchain-token";
import { CURVE_ABI, LOG_RPC_URLS } from "./abis";

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

const CHUNK = 9_000n; // largest range every working public RPC accepts
const MAX_LOOKBACK = 600_000n; // ~21 days on BSC (3s blocks)
const MAX_CHUNKS_PER_PAGE = 12; // bounds latency of a single page request

let preferredRpc: string | null = null;

function clientFor(url: string): PublicClient {
  return createPublicClient({ chain: bscTestnet, transport: http(url) }) as PublicClient;
}

/**
 * Runs one getLogs range across the candidate RPCs.
 * Throws the last real error when every endpoint refuses.
 */
async function getLogsRange(curve: `0x${string}`, from: bigint, to: bigint) {
  const urls = preferredRpc ? [preferredRpc, ...LOG_RPC_URLS.filter((u) => u !== preferredRpc)] : [...LOG_RPC_URLS];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const logs = await clientFor(url).getLogs({ address: curve, event: TRADE_EVENT, fromBlock: from, toBlock: to });
      preferredRpc = url;
      return logs;
    } catch (e) {
      lastError = e;
      console.warn(`[curve-events] getLogs failed on ${url}:`, (e as Error).message);
      if (preferredRpc === url) preferredRpc = null;
    }
  }
  throw new Error(
    `Ningún RPC de BSC Testnet aceptó eth_getLogs (${from}-${to}). Último error: ${
      (lastError as Error)?.message ?? "desconocido"
    }`,
  );
}

function decode(logs: Awaited<ReturnType<typeof getLogsRange>>): TradeEvent[] {
  const out: TradeEvent[] = [];
  for (const log of logs) {
    const a = log.args as {
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

export type TradePage = {
  events: TradeEvent[]; // oldest → newest inside the page
  /** Block to continue from (scanning backwards); null when the history ends. */
  nextCursor: string | null;
  scannedFrom: string;
  scannedTo: string;
};

/**
 * Paginated history: scans backwards from `cursor` (or the chain head) in
 * CHUNK-sized ranges until it collects `pageSize` trades, exhausts the
 * lookback window, or hits the per-page chunk budget.
 */
export async function fetchTradePage(
  curve: `0x${string}`,
  cursor?: string | null,
  pageSize = 25,
): Promise<TradePage> {
  const head = await readClient().getBlockNumber();
  const to = cursor ? BigInt(cursor) : head;
  const floor = head > MAX_LOOKBACK ? head - MAX_LOOKBACK : 0n;

  const collected: TradeEvent[] = [];
  let upper = to;
  let chunks = 0;

  while (upper >= floor && collected.length < pageSize && chunks < MAX_CHUNKS_PER_PAGE) {
    const lower = upper > floor + CHUNK ? upper - CHUNK + 1n : floor;
    const logs = await getLogsRange(curve, lower, upper);
    collected.unshift(...decode(logs));
    chunks += 1;
    if (lower === floor) {
      upper = floor - 1n;
      break;
    }
    upper = lower - 1n;
  }

  collected.sort((x, y) => (x.blockNumber === y.blockNumber ? 0 : x.blockNumber < y.blockNumber ? -1 : 1));

  return {
    events: collected,
    nextCursor: upper >= floor ? upper.toString() : null,
    scannedFrom: (upper + 1n).toString(),
    scannedTo: to.toString(),
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
