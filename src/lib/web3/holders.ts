// Top holders read directly from the blockchain (ERC-20 Transfer logs).
// No indexer, no database: we scan backwards in grid-aligned chunks until the
// mint (from = 0x0) shows up, which makes the reconstructed balances exact.
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { bsc, bscTestnet } from "wagmi/chains";
import { readClient } from "./onchain-token";
import { ACTIVE_NETWORK } from "./networks";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const ZERO = "0x0000000000000000000000000000000000000000";
// Scan the same 21-day window used by trade history. Transfer ranges are read
// in parallel batches so a token created several days ago does not exceed the
// UI deadline while waiting for dozens of sequential RPC round-trips.
const CHUNK = 4_000n;
const MAX_CHUNKS = 150; // ~600k blocks (~21 days) upper bound
const PARALLEL_CHUNKS = 16;

// Keep this scan isolated from the trade-history paginator. Sharing its
// adaptive provider state caused a 5-block fallback limit to turn one holder
// query into tens of thousands of requests.
const holderClient = createPublicClient({
  chain: ACTIVE_NETWORK.chainId === bsc.id ? bsc : bscTestnet,
  transport: http(ACTIVE_NETWORK.logRpcUrls[0], {
    batch: false,
    timeout: 15_000,
    retryCount: 1,
  }),
});

async function transferLogs(token: `0x${string}`, from: bigint, to: bigint): Promise<Log[]> {
  return holderClient.getLogs({
    address: token,
    event: TRANSFER_EVENT,
    fromBlock: from,
    toBlock: to,
  }) as Promise<Log[]>;
}


export type Holder = {
  address: `0x${string}`;
  balance: bigint;
  share: number; // % of circulating tracked supply
};

export type HoldersResult = {
  holders: Holder[];
  total: bigint;
  complete: boolean; // true when the mint was found inside the scanned window
  count: number;
};

const cache = new Map<string, { at: number; value: HoldersResult }>();
const TTL = 60_000;

/** Reconstructs balances from Transfer events and returns the biggest wallets. */
export async function fetchTopHolders(token: `0x${string}`, top = 10): Promise<HoldersResult> {
  const key = `${token.toLowerCase()}:${top}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const head = await readClient().getBlockNumber();
  const collected: Log[] = [];
  let complete = false;

  let index = Number(head / CHUNK);
  let scanned = 0;
  while (scanned < MAX_CHUNKS && index >= 0 && !complete) {
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    for (let i = 0; i < PARALLEL_CHUNKS && scanned < MAX_CHUNKS && index >= 0; i += 1) {
      const from = BigInt(index) * CHUNK;
      const to = from + CHUNK - 1n;
      ranges.push({ from, to: to > head ? head : to });
      index -= 1;
      scanned += 1;
    }

    const batches = await Promise.all(ranges.map(({ from, to }) => transferLogs(token, from, to)));
    for (const logs of batches) {
      for (const log of logs) {
        const a = (log as Log & { args?: Record<string, unknown> }).args as {
          from?: `0x${string}`;
        };
        if (a.from === ZERO) complete = true;
      }
      collected.push(...logs);
    }
  }

  // The scan runs newest → oldest to find the mint quickly, but balances must
  // be reconstructed oldest → newest. Processing in scan order made sells and
  // later transfers produce incorrect holder balances and percentages.
  collected.sort((a, b) => {
    const blockA = a.blockNumber ?? 0n;
    const blockB = b.blockNumber ?? 0n;
    if (blockA !== blockB) return blockA < blockB ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const balances = new Map<string, bigint>();
  for (const log of collected) {
    const a = (log as Log & { args?: Record<string, unknown> }).args as {
      from?: `0x${string}`;
      to?: `0x${string}`;
      value?: bigint;
    };
    const value = a.value ?? 0n;
    if (!value) continue;
    if (a.from && a.from !== ZERO) balances.set(a.from, (balances.get(a.from) ?? 0n) - value);
    if (a.to && a.to !== ZERO) balances.set(a.to, (balances.get(a.to) ?? 0n) + value);
  }

  const list = [...balances.entries()]
    .filter(([, v]) => v > 0n)
    .sort((x, y) => (x[1] === y[1] ? 0 : x[1] < y[1] ? 1 : -1));

  const total = list.reduce((acc, [, v]) => acc + v, 0n);
  const holders: Holder[] = list.slice(0, top).map(([address, balance]) => ({
    address: address as `0x${string}`,
    balance,
    share: total > 0n ? Number((balance * 10000n) / total) / 100 : 0,
  }));

  const value: HoldersResult = { holders, total, complete, count: list.length };
  cache.set(key, { at: Date.now(), value });
  return value;
}
