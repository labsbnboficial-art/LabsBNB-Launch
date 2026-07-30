// Reads Trade(...) events + live views straight from the BondingCurve contract.
// Everything on this page comes from the chain — no database, no simulation.
import { parseAbiItem, type Abi } from "viem";
import { readClient } from "./onchain-token";
import { CURVE_ABI } from "./abis";

export const TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed trader, bool isBuy, uint256 amountBnb, uint256 amountTokens, uint256 price, uint256 marketCap, uint256 timestamp)",
);

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

const CHUNK = 5000n; // public BSC RPCs cap getLogs ranges
const LOOKBACK = 200_000n; // ~7 days on BSC (3s blocks)

/** Fetches every Trade event of a curve within the lookback window, oldest → newest. */
export async function fetchTradeEvents(curve: `0x${string}`): Promise<TradeEvent[]> {
  const client = readClient();
  const latest = await client.getBlockNumber();
  const from = latest > LOOKBACK ? latest - LOOKBACK : 0n;

  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    ranges.push({ from: start, to: end });
  }

  const chunks = await Promise.all(
    ranges.map(async (r) => {
      try {
        return await client.getLogs({ address: curve, event: TRADE_EVENT, fromBlock: r.from, toBlock: r.to });
      } catch {
        return [];
      }
    }),
  );

  const out: TradeEvent[] = [];
  for (const logs of chunks) {
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
  }

  out.sort((x, y) =>
    x.blockNumber === y.blockNumber ? 0 : x.blockNumber < y.blockNumber ? -1 : 1,
  );
  return out;
}

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
