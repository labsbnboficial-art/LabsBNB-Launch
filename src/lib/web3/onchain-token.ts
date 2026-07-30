// On-chain fallback reader: lets a token page render even if the database row
// is missing (save failed, RLS, offline backend). Everything here is read-only.
import { createPublicClient, http, type Abi } from "viem";
import { bscTestnet } from "wagmi/chains";
import { FACTORY_ABI, CURVE_ABI, TOKEN_ABI, BSC_TESTNET } from "./abis";
import { DEFAULT_CONFIG } from "@/lib/launchpad-config";

export const EXPLORER = BSC_TESTNET.explorer;

export function readClient() {
  return createPublicClient({ chain: bscTestnet, transport: http(BSC_TESTNET.rpcUrl) });
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
