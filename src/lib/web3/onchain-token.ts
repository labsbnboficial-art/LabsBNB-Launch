// On-chain fallback reader: lets a token page render even if the database row
// is missing (save failed, RLS, offline backend). Everything here is read-only.
import { createPublicClient, http, type Abi } from "viem";
import { bscTestnet } from "wagmi/chains";
import { FACTORY_ABI, CURVE_ABI, TOKEN_ABI, BSC_TESTNET } from "./abis";
import { DEFAULT_CONFIG } from "@/lib/launchpad-config";

export const EXPLORER = BSC_TESTNET.explorer;

/**
 * Shared read client. `batch.multicall` aggregates all the concurrent
 * `readContract` calls of a render into a single RPC round-trip, which keeps
 * the homepage and the token page well under public-RPC rate limits.
 */
let cachedClient: ReturnType<typeof createPublicClient> | null = null;
export function readClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: bscTestnet,
      transport: http(BSC_TESTNET.rpcUrl, { batch: true }),
      batch: { multicall: { wait: 24 } },
    });
  }
  return cachedClient;
}

export type OnChainToken = {
  address: `0x${string}`;
  curve: `0x${string}` | null;
  creator: string | null;
  name: string;
  ticker: string;
  metadataURI: string | null;
  totalSupply: string;
  progressBps: number;
  targetBnbWei: string;
  realLiquidityWei: string;
  marketCapWei: string;
  volume24hWei: string;
  holders: number;
  onchain: true;
};

export function isAddress(v: string): v is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

/** Reads a deployed token straight from the factory + token + curve contracts. */
export async function fetchOnChainToken(
  address: string,
  factoryAddress?: string | null,
): Promise<OnChainToken | null> {
  if (!isAddress(address)) return null;
  const client = readClient();
  const factory = (factoryAddress ?? DEFAULT_CONFIG.factory_address) as `0x${string}` | null;

  let name: string;
  let symbol: string;
  try {
    [name, symbol] = (await Promise.all([
      client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "name" }),
      client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "symbol" }),
    ])) as [string, string];
  } catch {
    return null; // not a contract / not reachable
  }

  const safe = async <T>(p: Promise<unknown>, fallback: T): Promise<T> => {
    try { return (await p) as T; } catch { return fallback; }
  };

  const [metadataURI, totalSupply, creatorFromToken] = await Promise.all([
    safe<string | null>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "metadataURI" }), null),
    safe<bigint>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "totalSupply" }), 0n),
    safe<string | null>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "creator" }), null),
  ]);

  let curve: `0x${string}` | null = null;
  if (factory) {
    curve = await safe<`0x${string}` | null>(
      client.readContract({ address: factory, abi: FACTORY_ABI as Abi, functionName: "curveOf", args: [address] }),
      null,
    );
    if (curve && /^0x0{40}$/.test(curve)) curve = null;
  }

  let progressBps = 0;
  let realLiquidity = 0n;
  let marketCap = 0n;
  let volume24h = 0n;
  let holders = 0;
  let target = 0n;
  if (curve) {
    const c = curve;
    const [p, rl, mc, v24, h, thr] = await Promise.all([
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "progress" }), 0n),
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "realLiquidity" }), 0n),
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "marketCap" }), 0n),
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "volume24h" }), 0n),
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "holders" }), 0n),
      safe<bigint>(client.readContract({ address: c, abi: CURVE_ABI as Abi, functionName: "MIGRATION_THRESHOLD" }), 0n),
    ]);
    progressBps = Number(p);
    realLiquidity = rl;
    marketCap = mc;
    volume24h = v24;
    holders = Number(h);
    target = thr;
  }

  return {
    address,
    curve,
    creator: (creatorFromToken as string | null) ?? null,
    name: name || "Unknown token",
    ticker: symbol || "???",
    metadataURI: metadataURI || null,
    totalSupply: totalSupply.toString(),
    progressBps,
    targetBnbWei: target.toString(),
    realLiquidityWei: realLiquidity.toString(),
    marketCapWei: marketCap.toString(),
    volume24hWei: volume24h.toString(),
    holders,
    onchain: true,
  };
}

export type CurveMetrics = {
  priceWei: string;
  marketCapWei: string;
  liquidityWei: string;
  volume24hWei: string;
  priceChangeBps: number;
  progressBps: number;
  holders: number;
  targetBnbWei: string;
};

const safeRead = async <T>(p: Promise<unknown>, fallback: T): Promise<T> => {
  try { return (await p) as T; } catch { return fallback; }
};

/** Live analytics of a bonding curve (price, mcap, liquidity, volume, progress). */
export async function fetchCurveMetrics(curve: `0x${string}`): Promise<CurveMetrics> {
  const client = readClient();
  const read = (functionName: string) =>
    safeRead<bigint>(client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName }), 0n);
  const [price, mcap, liq, vol, change, progress, holders, target] = await Promise.all([
    read("currentPrice"),
    read("marketCap"),
    read("realLiquidity"),
    read("volume24h"),
    read("priceChange"),
    read("progress"),
    read("holders"),
    read("MIGRATION_THRESHOLD"),
  ]);
  return {
    priceWei: price.toString(),
    marketCapWei: mcap.toString(),
    liquidityWei: liq.toString(),
    volume24hWei: vol.toString(),
    priceChangeBps: Number(change),
    progressBps: Number(progress),
    holders: Number(holders),
    targetBnbWei: target.toString(),
  };
}

export type FactoryToken = {
  address: `0x${string}`;
  curve: `0x${string}` | null;
  creator: string | null;
  name: string;
  ticker: string;
  metadataURI: string | null;
  index: number;
  metrics: CurveMetrics | null;
};


/**
 * Reads the token list straight from the Factory (`allTokensLength` + `allTokens`).
 * Guarantees the launchpad listing never depends solely on the database.
 */
export async function fetchFactoryTokens(
  limit = 24,
  factoryAddress?: string | null,
): Promise<FactoryToken[]> {
  const factory = (factoryAddress ?? DEFAULT_CONFIG.factory_address) as `0x${string}` | null;
  if (!factory || !isAddress(factory)) return [];
  const client = readClient();

  let total = 0;
  try {
    total = Number(
      (await client.readContract({
        address: factory,
        abi: FACTORY_ABI as Abi,
        functionName: "allTokensLength",
      })) as bigint,
    );
  } catch {
    return [];
  }
  if (!total) return [];

  const start = Math.max(0, total - limit);
  const indexes: number[] = [];
  for (let i = total - 1; i >= start; i--) indexes.push(i);

  const addresses = await Promise.all(
    indexes.map(async (i) => {
      try {
        return {
          index: i,
          address: (await client.readContract({
            address: factory,
            abi: FACTORY_ABI as Abi,
            functionName: "allTokens",
            args: [BigInt(i)],
          })) as `0x${string}`,
        };
      } catch {
        return null;
      }
    }),
  );

  const rows = await Promise.all(
    addresses
      .filter((a): a is { index: number; address: `0x${string}` } => !!a && isAddress(a.address))
      .map(async ({ index, address }) => {
        const safe = async <T>(p: Promise<unknown>, fallback: T): Promise<T> => {
          try { return (await p) as T; } catch { return fallback; }
        };
        const [name, ticker, metadataURI, curve, creator] = await Promise.all([
          safe<string>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "name" }), ""),
          safe<string>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "symbol" }), ""),
          safe<string | null>(client.readContract({ address, abi: TOKEN_ABI as Abi, functionName: "metadataURI" }), null),
          safe<`0x${string}` | null>(
            client.readContract({ address: factory, abi: FACTORY_ABI as Abi, functionName: "curveOf", args: [address] }),
            null,
          ),
          safe<string | null>(
            client.readContract({ address: factory, abi: FACTORY_ABI as Abi, functionName: "creatorOf", args: [address] }),
            null,
          ),
        ]);
        if (!name && !ticker) return null;
        const curveOk = curve && !/^0x0{40}$/.test(curve) ? curve : null;
        return {
          address,
          curve: curveOk,
          creator,
          name: name || "Unknown token",
          ticker: ticker || "???",
          metadataURI,
          index,
          metrics: curveOk ? await fetchCurveMetrics(curveOk) : null,
        } satisfies FactoryToken;

      }),
  );

  return rows.filter((r): r is FactoryToken => !!r);
}
