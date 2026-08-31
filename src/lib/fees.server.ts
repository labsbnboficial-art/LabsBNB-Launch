// Server-only helpers for the admin Fees dashboard.
// Everything here is read from chain (balance, FeeCollected events, receipts)
// plus the payment rows we persist for off-curve payments (Impulso / Advanced
// tokenomics). No simulated data.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient, formatEther, parseAbiItem, type Abi } from "viem";
import { activeTransport, activeViemChain } from "@/lib/web3/active-chain";
import { FACTORY_ABI } from "@/lib/web3/abis";
import { TESTNET_FACTORY } from "@/lib/launchpad-config";

export const DEFAULT_FEE_WALLET = "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e";

/** Blocks scanned for on-chain FeeCollected events (BSC ~3s/block → ~7 días). */
export const LOG_WINDOW_BLOCKS = 200_000n;
const CHUNK = 1_000n; // public BSC testnet RPCs reject wider eth_getLogs ranges
const CONCURRENCY = 4;


export type FeeKind = "buy" | "sell" | "create" | "advanced" | "boost";

export type FeeTx = {
  hash: string;
  kind: FeeKind;
  amountBnb: number;
  timestamp: string; // ISO
  from: string | null;
  source: "onchain" | "transfer";
};

export function publicClient() {
  return createPublicClient({ chain: activeViemChain(), transport: activeTransport() });
}

async function db(): Promise<SupabaseClient> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as SupabaseClient;
}

const FEE_COLLECTED = parseAbiItem(
  "event FeeCollected(address indexed to, uint256 amount, uint8 kind)",
);
const TRADE = parseAbiItem(
  "event Trade(address indexed trader, bool isBuy, uint256 amountBnb, uint256 amountTokens, uint256 price, uint256 marketCap, uint256 timestamp)",
);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

/** Reads the fee wallet + fee bps straight from the deployed Factory. */
export async function readFactoryFees(factory?: string) {
  const address = (factory && /^0x[a-fA-F0-9]{40}$/.test(factory) ? factory : TESTNET_FACTORY) as `0x${string}`;
  const c = publicClient();
  const [wallet, bps, owner] = await Promise.all([
    c.readContract({ address, abi: FACTORY_ABI as Abi, functionName: "feeWallet" }) as Promise<string>,
    c.readContract({ address, abi: FACTORY_ABI as Abi, functionName: "feeBps" }) as Promise<number>,
    c.readContract({ address, abi: FACTORY_ABI as Abi, functionName: "owner" }) as Promise<string>,
  ]);
  return { factory: address, wallet, bps: Number(bps), owner };
}

/**
 * Scans FeeCollected(to = feeWallet) across every bonding curve, and resolves
 * whether each fee came from a buy or a sell using the Trade event emitted in
 * the same transaction.
 */
async function scanCurveFees(feeWallet: `0x${string}`): Promise<FeeTx[]> {
  const c = publicClient();
  const latest = await c.getBlockNumber();
  const from = latest > LOG_WINDOW_BLOCKS ? latest - LOG_WINDOW_BLOCKS : 0n;

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    ranges.push({ from: start, to: end });
  }

  const chunks = await mapLimit(ranges, CONCURRENCY, async (r) => {
    try {
      return await c.getLogs({ event: FEE_COLLECTED, args: { to: feeWallet }, fromBlock: r.from, toBlock: r.to });
    } catch {
      return [];
    }
  });
  const logs = chunks.flat();
  if (logs.length === 0) return [];

  // Resolve direction (buy/sell) + timestamp per unique transaction.
  const byTx = new Map<string, { amount: bigint; block: bigint; address: `0x${string}` }>();
  for (const l of logs) {
    if (Number((l.args as { kind?: number }).kind ?? 0) !== 0) continue; // 0 = protocol
    const amount = ((l.args as { amount?: bigint }).amount ?? 0n);
    const key = l.transactionHash as string;
    const prev = byTx.get(key);
    byTx.set(key, {
      amount: (prev?.amount ?? 0n) + amount,
      block: l.blockNumber ?? 0n,
      address: l.address,
    });
  }

  const entries = [...byTx.entries()].sort((a, b) => Number(b[1].block - a[1].block)).slice(0, 200);
  const blockTimes = new Map<bigint, number>();
  await mapLimit([...new Set(entries.map(([, v]) => v.block))], CONCURRENCY, async (bn) => {
    try {
      const b = await c.getBlock({ blockNumber: bn });
      blockTimes.set(bn, Number(b.timestamp));
    } catch { /* keep undefined */ }
    return null;
  });

  return await mapLimit(entries, CONCURRENCY, async ([hash, v]) => {
    let kind: FeeKind = "buy";
    let trader: string | null = null;
    try {
      const receipt = await c.getTransactionReceipt({ hash: hash as `0x${string}` });
      trader = receipt.from;
      for (const log of receipt.logs) {
        if (log.topics[0] !== undefined && log.address.toLowerCase() === v.address.toLowerCase()) {
          try {
            const decoded = await c.getLogs({
              event: TRADE,
              address: v.address,
              fromBlock: v.block,
              toBlock: v.block,
            });
            const match = decoded.find((d) => d.transactionHash === hash);
            if (match) kind = (match.args as { isBuy?: boolean }).isBuy ? "buy" : "sell";
            break;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    const ts = blockTimes.get(v.block);
    return {
      hash,
      kind,
      amountBnb: Number(formatEther(v.amount)),
      timestamp: new Date((ts ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      from: trader,
      source: "onchain" as const,
    };
  });
}

/** Boost (Impulso) + Advanced tokenomics payments are direct BNB transfers. */
async function readTransferPayments(feeWallet: string): Promise<FeeTx[]> {
  const client = await db();
  const out: FeeTx[] = [];

  const { data: boosts } = await client
    .from("token_boosts")
    .select("tx_hash,total_paid,created_at,starts_at,owner_wallet")
    .order("starts_at", { ascending: false })
    .limit(100);
  for (const b of (boosts ?? []) as Record<string, unknown>[]) {
    if (!b["tx_hash"]) continue;
    out.push({
      hash: String(b["tx_hash"]),
      kind: "boost",
      amountBnb: Number(b["total_paid"] ?? 0),
      timestamp: String(b["created_at"] ?? b["starts_at"] ?? new Date().toISOString()),
      from: (b["owner_wallet"] as string) ?? null,
      source: "transfer",
    });
  }

  const { data: acts } = await client
    .from("activity")
    .select("payload,created_at")
    .eq("kind", "advanced_tokenomics")
    .order("created_at", { ascending: false })
    .limit(100);
  for (const a of (acts ?? []) as { payload: Record<string, unknown> | null; created_at: string }[]) {
    const p = a.payload ?? {};
    const hash = p["payment_tx"];
    if (typeof hash !== "string" || !hash.startsWith("0x")) continue;
    const wei = p["payment_amount_wei"];
    let amount = 0;
    try { amount = Number(formatEther(BigInt(String(wei ?? "0")))); } catch { amount = 0; }
    out.push({
      hash,
      kind: "advanced",
      amountBnb: amount,
      timestamp: a.created_at,
      from: (p["payment_wallet"] as string) ?? null,
      source: "transfer",
    });
  }

  void feeWallet;
  return out;
}

export async function buildFeeDashboard(factory?: string) {
  const meta = await readFactoryFees(factory);
  const wallet = (meta.wallet || DEFAULT_FEE_WALLET) as `0x${string}`;
  const c = publicClient();

  const [balanceWei, curveFees, transfers] = await Promise.all([
    c.getBalance({ address: wallet }).catch(() => 0n),
    scanCurveFees(wallet).catch(() => [] as FeeTx[]),
    readTransferPayments(wallet).catch(() => [] as FeeTx[]),
  ]);

  const txs = [...curveFees, ...transfers].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const now = Date.now();
  const sum = (since: number) =>
    txs.filter((t) => new Date(t.timestamp).getTime() >= since).reduce((s, t) => s + t.amountBnb, 0);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  const byKind: Record<FeeKind, number> = { buy: 0, sell: 0, create: 0, advanced: 0, boost: 0 };
  for (const t of txs) byKind[t.kind] += t.amountBnb;

  return {
    factory: meta.factory,
    owner: meta.owner,
    wallet,
    feeBps: meta.bps,
    expectedWallet: DEFAULT_FEE_WALLET,
    walletMatches: wallet.toLowerCase() === DEFAULT_FEE_WALLET.toLowerCase(),
    balanceBnb: Number(formatEther(balanceWei)),
    totals: {
      all: txs.reduce((s, t) => s + t.amountBnb, 0),
      today: sum(startOfDay.getTime()),
      d7: sum(now - 7 * 86_400_000),
      d30: sum(now - 30 * 86_400_000),
    },
    byKind,
    windowBlocks: Number(LOG_WINDOW_BLOCKS),
    txs: txs.slice(0, 20),
    scannedAt: new Date().toISOString(),
  };
}
