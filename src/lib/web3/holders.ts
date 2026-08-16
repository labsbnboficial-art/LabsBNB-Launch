// Top holders read directly from the blockchain (ERC-20 Transfer logs).
// No indexer, no database: we scan backwards in grid-aligned chunks until the
// mint (from = 0x0) shows up, which makes the reconstructed balances exact.
import { parseAbiItem, type Log } from "viem";
import { readClient } from "./onchain-token";
import { getLogsChunked } from "./log-range";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const ZERO = "0x0000000000000000000000000000000000000000";
// Cache/scan granularity: each range is split further into RPC-safe windows.
const CHUNK = 3_000n;
const MAX_CHUNKS = 72; // ~216k blocks (~7 days) upper bound

async function transferLogs(token: `0x${string}`, from: bigint, to: bigint): Promise<Log[]> {
  return getLogsChunked({ address: token, event: TRANSFER_EVENT, from, to, label: `Transfer ${token.slice(0, 10)}` });
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
  const balances = new Map<string, bigint>();
  let complete = false;

  let index = Number(head / CHUNK);
  for (let i = 0; i < MAX_CHUNKS && index >= 0; i++, index--) {
    const from = BigInt(index) * CHUNK;
    const to = from + CHUNK - 1n;
    const logs = await transferLogs(token, from, to > head ? head : to);
    for (const log of logs) {
      const a = (log as Log & { args?: Record<string, unknown> }).args as {
        from?: `0x${string}`;
        to?: `0x${string}`;
        value?: bigint;
      };

      const value = a.value ?? 0n;
      if (!value) continue;
      if (a.from && a.from !== ZERO) balances.set(a.from, (balances.get(a.from) ?? 0n) - value);
      if (a.to && a.to !== ZERO) balances.set(a.to, (balances.get(a.to) ?? 0n) + value);
      if (a.from === ZERO) complete = true;
    }
    if (complete) break;
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
