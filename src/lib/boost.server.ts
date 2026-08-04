// Server-only helpers for the premium "🚀 Impulso" (boost) section.
// Payments are plain BNB transfers to the configured treasury wallet and are
// verified on-chain (receipt status, recipient, amount, sender) before any row
// is written. Nothing here is simulated.
import { createPublicClient, formatEther, parseEther, type Abi } from "viem";
import { bscTestnet } from "viem/chains";
import { testnetTransport } from "@/lib/web3/rpc";
import { FACTORY_ABI, TOKEN_ABI } from "@/lib/web3/abis";
import { TESTNET_FACTORY } from "@/lib/launchpad-config";

export const DEFAULT_BOOST_WALLET = "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e";

export type BoostSettings = {
  enabled: boolean;
  pricePerDayBnb: number;
  currency: string;
  wallet: string;
  maxSlots: number;
  autoApprove: boolean;
  maxDays: number;
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const clean = v.replace(/^"|"$/g, "").trim();
  return clean || fallback;
}

export function client() {
  return createPublicClient({ chain: bscTestnet, transport: testnetTransport() });
}

export async function readSettings(): Promise<BoostSettings> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  const { data } = await adminClient
    .from("admin_config")
    .select("key,value")
    .in("key", [
      "boost_enabled",
      "boost_price_per_day_bnb",
      "boost_currency",
      "boost_wallet",
      "boost_max_slots",
      "boost_auto_approve",
      "boost_max_days",
    ]);
  const map: Record<string, unknown> = {};
  (data ?? []).forEach((r: { key: string; value: unknown }) => { map[r.key] = r.value; });
  return {
    enabled: bool(map["boost_enabled"], true),
    pricePerDayBnb: num(map["boost_price_per_day_bnb"], 0.05),
    currency: str(map["boost_currency"], "BNB"),
    wallet: str(map["boost_wallet"], DEFAULT_BOOST_WALLET),
    maxSlots: Math.max(1, Math.round(num(map["boost_max_slots"], 10))),
    autoApprove: bool(map["boost_auto_approve"], true),
    maxDays: Math.max(1, Math.round(num(map["boost_max_days"], 30))),
  };
}

/** Moves every expired boost to `finished`. Cheap and idempotent. */
export async function expireBoosts() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  await adminClient
    .from("token_boosts")
    .update({ status: "finished" })
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString());
}

export type PackageRow = {
  id: string;
  name: string;
  days: number;
  price_bnb: number | null;
  active: boolean;
  sort_order: number;
};

export function packagePrice(pkg: Pick<PackageRow, "days" | "price_bnb">, s: BoostSettings): number {
  const explicit = pkg.price_bnb == null ? null : Number(pkg.price_bnb);
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit;
  return Number((pkg.days * s.pricePerDayBnb).toFixed(8));
}

/** On-chain creator of a launchpad token (reverts to null when unknown). */
export async function creatorOf(token: `0x${string}`): Promise<string | null> {
  try {
    const c = client();
    const creator = (await c.readContract({
      address: TESTNET_FACTORY,
      abi: FACTORY_ABI as Abi,
      functionName: "creatorOf",
      args: [token],
    })) as string;
    if (!creator || /^0x0{40}$/i.test(creator)) return null;
    return creator.toLowerCase();
  } catch {
    return null;
  }
}

export async function tokenIdentity(token: `0x${string}`): Promise<{ name: string; ticker: string }> {
  const c = client();
  const read = async (fn: string) => {
    try {
      return String(await c.readContract({ address: token, abi: TOKEN_ABI as Abi, functionName: fn }));
    } catch {
      return "";
    }
  };
  const [name, ticker] = await Promise.all([read("name"), read("symbol")]);
  return { name, ticker };
}

/**
 * Verifies a BNB payment transaction.
 * Throws with a human message when anything does not match.
 */
export async function verifyPayment(args: {
  txHash: `0x${string}`;
  to: string;
  from: string;
  amountBnb: number;
}): Promise<{ paid: number }> {
  const c = client();
  let receipt;
  try {
    receipt = await c.waitForTransactionReceipt({ hash: args.txHash, timeout: 90_000 });
  } catch {
    throw new Error("No se pudo confirmar la transacción de pago en la red. Reintenta en unos segundos.");
  }
  if (receipt.status !== "success") throw new Error("La transacción de pago falló on-chain.");

  const tx = await c.getTransaction({ hash: args.txHash });
  if (!tx.to || tx.to.toLowerCase() !== args.to.toLowerCase()) {
    throw new Error("El pago no se envió a la wallet de tesorería configurada.");
  }
  if (tx.from.toLowerCase() !== args.from.toLowerCase()) {
    throw new Error("El pago no proviene de la wallet conectada.");
  }
  // 0.5% tolerance for float→wei rounding.
  const expected = parseEther(args.amountBnb.toFixed(8));
  const min = (expected * 995n) / 1000n;
  if (tx.value < min) {
    throw new Error(
      `Importe insuficiente: se recibieron ${formatEther(tx.value)} BNB y el plan cuesta ${args.amountBnb} BNB.`,
    );
  }
  return { paid: Number(formatEther(tx.value)) };
}
