// Live price source for a token.
//
// While the bonding curve has NOT migrated we read `currentPrice()` (plus the
// rest of the curve views) straight from the BondingCurve contract.
// Once `migrated == true` the curve stops being the market: we detect
// `pancakePair()` and derive the price from the PancakeSwap pair reserves,
// switching source automatically with no user interaction.
import { type Abi, erc20Abi } from "viem";
import { CURVE_ABI, BSC_TESTNET } from "./abis";
import { readClient } from "./onchain-token";

export const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export type PriceSource = "curve" | "pancake";

export type LivePrice = {
  /** BNB per token, 18-decimals fixed point. */
  priceWei: bigint;
  marketCapWei: bigint;
  liquidityWei: bigint;
  volume24hWei: bigint;
  priceChangeBps: number;
  progressBps: number;
  holders: number;
  targetBnbWei: bigint;
  migrated: boolean;
  pair: `0x${string}` | null;
  source: PriceSource;
  /** Block height the values were read at (drives per-block refresh). */
  blockNumber: bigint;
};

const safe = async <T>(p: Promise<unknown>, fallback: T): Promise<T> => {
  try {
    return (await p) as T;
  } catch {
    return fallback;
  }
};

const ZERO = /^0x0{40}$/;

/** Price from a PancakeSwap pair: BNB reserve / token reserve, 1e18 scaled. */
async function pancakePrice(pair: `0x${string}`, token: `0x${string}`) {
  const client = readClient();
  const [reserves, token0] = await Promise.all([
    safe<readonly [bigint, bigint, number] | null>(
      client.readContract({ address: pair, abi: PAIR_ABI as unknown as Abi, functionName: "getReserves" }),
      null,
    ),
    safe<`0x${string}` | null>(
      client.readContract({ address: pair, abi: PAIR_ABI as unknown as Abi, functionName: "token0" }),
      null,
    ),
  ]);
  if (!reserves || !token0) return { priceWei: 0n, liquidityWei: 0n };
  const tokenIsZero = token0.toLowerCase() === token.toLowerCase();
  const reserveToken = tokenIsZero ? reserves[0] : reserves[1];
  const reserveBnb = tokenIsZero ? reserves[1] : reserves[0];
  if (reserveToken === 0n) return { priceWei: 0n, liquidityWei: reserveBnb };
  return { priceWei: (reserveBnb * 10n ** 18n) / reserveToken, liquidityWei: reserveBnb };
}

/**
 * One round-trip snapshot of everything the UI shows live: price, market cap,
 * liquidity, progress, 24h stats — with the source picked automatically.
 */
export async function fetchLivePrice(
  curve: `0x${string}`,
  tokenAddress?: `0x${string}` | null,
): Promise<LivePrice> {
  const client = readClient();
  const read = (functionName: string) =>
    safe<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName }), 0n);

  const [price, mcap, liq, vol, change, progress, holders, target, migrated, pairRaw, tokenRaw, blockNumber] =
    await Promise.all([
      read("currentPrice"),
      read("marketCap"),
      read("realLiquidity"),
      read("volume24h"),
      read("priceChange"),
      read("progress"),
      read("holders"),
      read("MIGRATION_THRESHOLD"),
      safe<boolean>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "migrated" }), false),
      safe<`0x${string}` | null>(
        client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "pancakePair" }),
        null,
      ),
      safe<`0x${string}` | null>(
        client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "token" }),
        null,
      ),
      safe<bigint>(client.getBlockNumber(), 0n),
    ]);

  const pair = pairRaw && !ZERO.test(pairRaw) ? pairRaw : null;
  const token = (tokenAddress ?? tokenRaw) as `0x${string}` | null;

  let priceWei = price;
  let liquidityWei = liq;
  let source: PriceSource = "curve";

  if (migrated && pair && token) {
    const dex = await pancakePrice(pair, token);
    if (dex.priceWei > 0n) {
      priceWei = dex.priceWei;
      liquidityWei = dex.liquidityWei;
      source = "pancake";
    }
  }

  // Market cap follows whichever price is live (total supply stays constant).
  let marketCapWei = mcap;
  if (source === "pancake" && token) {
    const supply = await safe<bigint>(
      client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
      0n,
    );
    if (supply > 0n) marketCapWei = (priceWei * supply) / 10n ** 18n;
  }

  return {
    priceWei,
    marketCapWei,
    liquidityWei,
    volume24hWei: vol,
    priceChangeBps: Number(change),
    progressBps: migrated ? 10000 : Number(progress),
    holders: Number(holders),
    targetBnbWei: target,
    migrated,
    pair,
    source,
    blockNumber,
  };
}

export const PANCAKE_INFO = `${BSC_TESTNET.explorer}/address/`;

/**
 * High-precision price formatting: tokens on a fresh curve cost ~1e-9 BNB, so
 * a fixed 2-6 decimal format renders "0.00". We keep up to 12 decimals and
 * always show at least 4 significant digits.
 */
export function formatPrice(priceWei: bigint | string | number | null | undefined, maxDecimals = 12): string {
  const n =
    typeof priceWei === "bigint"
      ? Number(priceWei) / 1e18
      : typeof priceWei === "string"
        ? Number(priceWei) / 1e18
        : typeof priceWei === "number"
          ? priceWei
          : 0;
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1) return n.toFixed(4);
  const magnitude = Math.floor(Math.log10(n)); // negative
  const decimals = Math.min(maxDecimals, Math.max(4, -magnitude + 3));
  const s = n.toFixed(decimals);
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
