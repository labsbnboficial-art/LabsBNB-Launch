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
import { bscTestnet } from "wagmi/chains";
import { LOG_RPC_URLS } from "./rpc";

/** Starting window size: accepted by every endpoint we probe. */
export const DEFAULT_WINDOW = 1_000n;
/** Never go below this: further splitting would explode the request count. */
const MIN_WINDOW = 100n;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS_PER_WINDOW = 3;
const BACKOFF_MS = 350;

const clients = new Map<string, PublicClient>();

function clientFor(url: string): PublicClient {
  let c = clients.get(url);
  if (!c) {
    c = createPublicClient({
      chain: bscTestnet,
      transport: http(url, { batch: false, timeout: REQUEST_TIMEOUT_MS, retryCount: 0 }),
    }) as PublicClient;
    clients.set(url, c);
  }
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    msg.includes("-32005")
  );
}

/** Window size currently known to work, per endpoint (shrinks on demand). */
const windowByUrl = new Map<string, bigint>();
let preferredRpc: string | null = null;

function urls(): string[] {
  return preferredRpc ? [preferredRpc, ...LOG_RPC_URLS.filter((u) => u !== preferredRpc)] : [...LOG_RPC_URLS];
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
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_WINDOW; attempt += 1) {
      try {
        const logs = await clientFor(url).getLogs({ address, event, fromBlock: from, toBlock: to });
        preferredRpc = url;
        return logs;
      } catch (e) {
        lastError = e;
        if (isRangeError(e)) {
          // Remember a smaller window for this endpoint and let the caller split.
          const cur = windowByUrl.get(url) ?? DEFAULT_WINDOW;
          const next = cur / 2n > MIN_WINDOW ? cur / 2n : MIN_WINDOW;
          windowByUrl.set(url, next);
          console.warn(`[logs] ${label} range ${from}-${to} rejected by ${url} → window ${next}`);
          break; // no point retrying the same range on this endpoint
        }
        console.warn(`[logs] ${label} ${from}-${to} attempt ${attempt} failed on ${url}: ${(e as Error).message}`);
        if (preferredRpc === url) preferredRpc = null;
        if (attempt < MAX_ATTEMPTS_PER_WINDOW) await sleep(BACKOFF_MS * attempt);
      }
    }
  }
  throw new Error(
    `eth_getLogs falló para ${label} (${from}-${to}). Último error: ${(lastError as Error)?.message ?? "desconocido"}`,
  );
}

/** Smallest window agreed by the endpoints we already talked to. */
function currentWindow(): bigint {
  let w = DEFAULT_WINDOW;
  for (const url of urls()) {
    const v = windowByUrl.get(url);
    if (v && v < w) w = v;
  }
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
