// Safe `eth_getLogs` reader for public BSC-Testnet RPCs.
//
// Public endpoints (data-seed, drpc, zan, ...) reject wide ranges with
// "Request exceeds defined limit" / "limit exceeded". Instead of asking for a
// whole range at once, every request is split into small windows, retried with
// backoff and shrunk automatically when the node complains about the range.
//
// Guarantees:
//  - windows are contiguous and inclusive → no event is lost between chunks
//  - results are deduped by `${txHash}:${logIndex}` → no duplicates at borders
//  - results are sorted by (blockNumber, logIndex) → chronological order
//  - bounded retries + per-request timeout → never blocks a run forever
import { createPublicClient, http, type AbiEvent, type Log, type PublicClient } from "viem";
import { bsc, bscTestnet } from "wagmi/chains";
import { ACTIVE_NETWORK } from "./networks";

/** Endpoints serving eth_getLogs for the ACTIVE network (see ./networks). */
const logUrls = (): string[] => [...ACTIVE_NETWORK.logRpcUrls];
const logChain = () => (ACTIVE_NETWORK.chainId === bsc.id ? bsc : bscTestnet);

/** Starting window size: accepted by every endpoint we probe. */
export const DEFAULT_WINDOW = 1_000n;
/** Some free providers cap eth_getLogs at only 5 blocks. */
const MIN_WINDOW = 5n;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS_PER_WINDOW = 2;
const BACKOFF_MS = 350;
const RPC_COOLDOWN_MS = 30_000;

const clients = new Map<string, PublicClient>();

function clientFor(url: string): PublicClient {
  let c = clients.get(url);
  if (!c) {
    c = createPublicClient({
      chain: logChain(),
      transport: http(url, { batch: false, timeout: REQUEST_TIMEOUT_MS, retryCount: 0 }),
    }) as PublicClient;
    clients.set(url, c);
  }
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rpcHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "RPC provider";
  }
}

function safeError(e: unknown): string {
  const message = String((e as Error)?.message ?? e ?? "unknown error");
  if (/failed to fetch/i.test(message)) return "network request failed";
  if (/rate limit|compute units|capacity|too many requests|429/i.test(message)) return "rate limit reached";
  if (isRangeError(e)) return "block range rejected";
  return "RPC request failed";
}

/** True when the node refused because the block range (or result set) is too big. */
export function isRangeError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("exceeds defined limit") ||
    msg.includes("limit exceeded") ||
    msg.includes("range") ||
    msg.includes("too many results") ||
    msg.includes("query returned more than") ||
    msg.includes("response size") ||
    msg.includes("block range") ||
    msg.includes("blocks range") ||
    msg.includes("limited to") ||
    msg.includes("archive requests require") ||
    msg.includes("-32005")
  );
}

/** Window size currently known to work, per endpoint (shrinks on demand). */
const windowByUrl = new Map<string, bigint>();
const unhealthyUntilByUrl = new Map<string, number>();
let preferredRpc: string | null = null;
// A range rejection is information about the request size, not an outage.
// Keep one conservative global window so switching providers cannot reset a
// just-learned 5/10-block limit back to DEFAULT_WINDOW.
let learnedWindow = DEFAULT_WINDOW;

function urls(): string[] {
  const all = logUrls();
  const ordered = preferredRpc ? [preferredRpc, ...all.filter((u) => u !== preferredRpc)] : all;
  const now = Date.now();
  const healthy = ordered.filter((url) => (unhealthyUntilByUrl.get(url) ?? 0) <= now);
  // If every provider is cooling down, retry the one whose cooldown expires
  // first instead of failing without making a request.
  if (healthy.length) return healthy;
  return [...ordered].sort(
    (a, b) => (unhealthyUntilByUrl.get(a) ?? 0) - (unhealthyUntilByUrl.get(b) ?? 0),
  ).slice(0, 1);
}

type Params = {
  address: `0x${string}`;
  event: AbiEvent;
  from: bigint;
  to: bigint;
  /** Free-form context used in log messages when a window fails. */
  label?: string;
};

/** Fetches one window across the candidate RPCs, shrinking on range errors. */
async function fetchWindow(address: `0x${string}`, event: AbiEvent, from: bigint, to: bigint, label: string) {
  let lastError: unknown = null;
  for (const url of urls()) {
    let transportFailed = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_WINDOW; attempt += 1) {
      try {
        const logs = await clientFor(url).getLogs({ address, event, fromBlock: from, toBlock: to });
        preferredRpc = url;
        unhealthyUntilByUrl.delete(url);
        return logs;
      } catch (e) {
        lastError = e;
        if (isRangeError(e)) {
          // Remember a smaller window for this endpoint and let the caller split.
          const cur = windowByUrl.get(url) ?? DEFAULT_WINDOW;
          const next = cur / 2n > MIN_WINDOW ? cur / 2n : MIN_WINDOW;
          windowByUrl.set(url, next);
          if (next < learnedWindow) learnedWindow = next;
          console.warn(`[logs] ${label} range ${from}-${to} rejected by ${rpcHost(url)} → window ${next}`);
          break; // no point retrying the same range on this endpoint
        }
        transportFailed = true;
        console.warn(`[logs] ${label} ${from}-${to} attempt ${attempt} failed on ${rpcHost(url)}: ${safeError(e)}`);
        if (preferredRpc === url) preferredRpc = null;
        if (attempt < MAX_ATTEMPTS_PER_WINDOW) await sleep(BACKOFF_MS * attempt);
      }
    }
    // A transport failure should immediately move subsequent/parallel windows
    // to another provider rather than hammering the same unavailable origin.
    // Range-limited nodes are healthy and may answer the reduced retry. Only
    // network/rate-limit failures should put a provider on cooldown.
    if (transportFailed) unhealthyUntilByUrl.set(url, Date.now() + RPC_COOLDOWN_MS);
  }
  throw new Error(
    `No se pudo consultar ${label} (${from}-${to}): ${safeError(lastError)}. Intenta nuevamente.`,
  );
}

/**
 * Window of the provider that most recently succeeded. A restrictive provider
 * must not globally force every healthy fallback down to 5-block requests.
 */
function currentWindow(): bigint {
  const preferredWindow = preferredRpc ? windowByUrl.get(preferredRpc) : undefined;
  const w = preferredWindow !== undefined && preferredWindow < learnedWindow
    ? preferredWindow
    : learnedWindow;
  return w < MIN_WINDOW ? MIN_WINDOW : w;
}

/**
 * Reads `[from, to]` (inclusive) in safe windows, merging, deduping and
 * sorting the result. Throws only when a window could not be read at all.
 */
export async function getLogsChunked({ address, event, from, to, label = "logs" }: Params): Promise<Log[]> {
  if (to < from) return [];
  const seen = new Set<string>();
  const out: Log[] = [];

  let cursor = from;
  let guard = 0;
  while (cursor <= to) {
    const window = currentWindow();
    const end = cursor + window - 1n > to ? to : cursor + window - 1n;

    let logs: Log[];
    try {
      logs = (await fetchWindow(address, event, cursor, end, label)) as Log[];
    } catch (e) {
      // A window rejected purely by size: retry immediately with the smaller
      // window the endpoint just taught us, without advancing the cursor.
      if (isRangeError(e) && currentWindow() < window) continue;
      throw e;
    }

    for (const log of logs) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(log);
    }

    cursor = end + 1n;
    guard += 1;
    if (guard > 5_000) break; // hard safety bound, never loop forever
  }

  out.sort((a, b) => {
    const ba = a.blockNumber ?? 0n;
    const bb = b.blockNumber ?? 0n;
    if (ba !== bb) return ba < bb ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
  return out;
}
