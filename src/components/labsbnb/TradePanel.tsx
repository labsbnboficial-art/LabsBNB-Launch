import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { parseEther, formatEther, type Abi } from "viem";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { CURVE_ABI, TOKEN_ABI, FACTORY_ABI, BSC_TESTNET } from "@/lib/web3/abis";
import { readClient, isAddress } from "@/lib/web3/onchain-token";
import { DEFAULT_CONFIG } from "@/lib/launchpad-config";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/config";
import { ACTIVE_NETWORK, assertTxTarget } from "@/lib/web3/networks";
import { invalidateTradeCache } from "@/lib/web3/curve-events";
import { describeTxError, ensureChain } from "@/lib/web3/tx";


const SLIPPAGE_BPS = 100n; // 1%

/** Percentage of the wallet balance, as a decimal string ready for the input. */
function fractionOfBalance(balance: bigint | undefined, pct: bigint): string {
  if (!balance) return "";
  return formatEther((balance * pct) / 100n);
}


/**
 * Runs `simulateContract` + `estimateContractGas` before every write and logs
 * chain id, contract, gas and the real revert reason when it fails.
 */
async function simulateOrThrow(
  client: ReturnType<typeof readClient>,
  req: Record<string, unknown>,
  label: string,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).simulateContract(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gas = await (client as any).estimateContractGas(req).catch(() => null);
    console.info(`[labsbnb] ${label} simulate OK`, {
      chainId: ACTIVE_CHAIN_ID,
      contract: req["address"],
      gas: gas ? String(gas) : "n/a",
    });
  } catch (e) {
    const err = e as { shortMessage?: string; details?: string; message?: string };
    const reason = err.shortMessage || err.details || err.message || "unknown revert";
    console.error(`[labsbnb] ${label} simulate FAILED`, { chainId: ACTIVE_CHAIN_ID, contract: req["address"], reason });
    throw new Error(reason);
  }
}

type CurveState = {
  curve: `0x${string}`;
  progressBps: number;
  liquidityWei: bigint;
  marketCapWei: bigint;
  migrated: boolean;
  paused: boolean;
};

/** Resolves the bonding curve for a token and reads its live state. */
async function loadCurve(token: `0x${string}`, known?: string | null): Promise<CurveState> {
  const client = readClient();
  let curve = known && isAddress(known) && !/^0x0{40}$/i.test(known) ? (known as `0x${string}`) : null;

  if (!curve) {
    const factory = DEFAULT_CONFIG.factory_address;
    if (!factory || !isAddress(factory)) throw new Error("Factory address no configurada.");
    const res = (await client.readContract({
      address: factory as `0x${string}`,
      abi: FACTORY_ABI as Abi,
      functionName: "curveOf",
      args: [token],
    })) as `0x${string}`;
    if (!res || /^0x0{40}$/i.test(res)) throw new Error("Bonding curve no encontrada para este token en el Factory.");
    curve = res;
  }

  const code = await client.getBytecode({ address: curve });
  if (!code || code === "0x") throw new Error(`No hay contrato desplegado en ${curve} en ${ACTIVE_NETWORK.name} (chain ${ACTIVE_CHAIN_ID}).`);

  const [progress, liquidity, marketCap, migrated, paused] = await Promise.all([
    client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "progress" }) as Promise<bigint>,
    client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "liquidity" }) as Promise<bigint>,
    client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "marketCap" }) as Promise<bigint>,
    client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "migrated" }) as Promise<boolean>,
    client.readContract({ address: curve, abi: CURVE_ABI as Abi, functionName: "paused" }) as Promise<boolean>,
  ]);

  return {
    curve,
    progressBps: Number(progress),
    liquidityWei: liquidity,
    marketCapWei: marketCap,
    migrated,
    paused,
  };
}

export function TradePanel({
  tokenTicker,
  tokenAddress,
  curveAddress,
}: {
  tokenTicker: string;
  tokenAddress?: string | null;
  curveAddress?: string | null;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { address: wallet, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();


  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const token = tokenAddress && isAddress(tokenAddress) ? (tokenAddress as `0x${string}`) : null;

  const curveQ = useQuery({
    queryKey: ["curve", token, curveAddress],
    enabled: !!token,
    retry: 1,
    refetchInterval: 20_000,
    queryFn: () => loadCurve(token!, curveAddress),
  });

  const curve = curveQ.data ?? null;

  // Live quote straight from the curve (quoteBuy / quoteSell).
  const quoteQ = useQuery({
    queryKey: ["quote", curve?.curve, side, amount],
    enabled: !!curve && !!amount && Number(amount) > 0,
    queryFn: async () => {
      const client = readClient();
      const wei = parseEther(amount);
      const [out, fee] = (await client.readContract({
        address: curve!.curve,
        abi: CURVE_ABI as Abi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [wei],
      })) as [bigint, bigint];
      return { out, fee };
    },
  });

  const balanceQ = useQuery({
    queryKey: ["tokenBalance", token, wallet],
    enabled: !!token && !!wallet && side === "sell",
    queryFn: async () => {
      const client = readClient();
      return (await client.readContract({
        address: token!,
        abi: TOKEN_ABI as Abi,
        functionName: "balanceOf",
        args: [wallet!],
      })) as bigint;
    },
  });

  useEffect(() => {
    setAmount("");
  }, [side]);

  const errorMsg = useMemo(() => {
    if (!token) return "Dirección de token inválida.";
    if (curveQ.isError) return (curveQ.error as Error).message;
    if (curve?.migrated) return "La curva migró a PancakeSwap. Opera en el DEX.";
    if (curve?.paused) return "El trading está pausado por el administrador.";
    return null;
  }, [token, curveQ.isError, curveQ.error, curve]);

  async function submit() {
    if (!curve || !token) return;
    if (!wallet) return toast.error("Conecta tu wallet primero.");
    if (!amount || Number(amount) <= 0) return toast.error("Introduce un importe.");
    setBusy(true);
    try {
      await ensureChain(ACTIVE_CHAIN_ID, chainId, switchChainAsync);
      assertTxTarget(chainId ?? ACTIVE_CHAIN_ID);
      const wei = parseEther(amount);
      const quoted = quoteQ.data?.out ?? 0n;
      const minOut = (quoted * (10000n - SLIPPAGE_BPS)) / 10000n;
      const client = readClient();

      let hash: `0x${string}`;
      if (side === "buy") {
        const buyReq = {
          account: wallet,
          address: curve.curve,
          abi: CURVE_ABI as Abi,
          functionName: "buy",
          args: [minOut, (ref && isAddress(ref) ? ref : "0x0000000000000000000000000000000000000000") as `0x${string}`],
          value: wei,
        } as const;
        // Simulate first: surfaces the real revert reason instead of a wallet error.
        await simulateOrThrow(client, buyReq, "buy");
        hash = await writeContractAsync({
          address: curve.curve,
          abi: CURVE_ABI as Abi,
          functionName: "buy",
          args: buyReq.args as unknown as unknown[],
          value: wei,
        });
      } else {
        const allowance = (await client.readContract({
          address: token,
          abi: TOKEN_ABI as Abi,
          functionName: "allowance",
          args: [wallet, curve.curve],
        })) as bigint;
        if (allowance < wei) {
          const approveHash = await writeContractAsync({
            address: token,
            abi: TOKEN_ABI as Abi,
            functionName: "approve",
            args: [curve.curve, wei],
          });
          await client.waitForTransactionReceipt({ hash: approveHash });
        }
        await simulateOrThrow(
          client,
          { account: wallet, address: curve.curve, abi: CURVE_ABI as Abi, functionName: "sell", args: [wei, minOut] },
          "sell",
        );
        hash = await writeContractAsync({
          address: curve.curve,
          abi: CURVE_ABI as Abi,
          functionName: "sell",
          args: [wei, minOut],
        });
      }

      toast.info("Transacción enviada", { description: hash.slice(0, 18) + "…" });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("La transacción falló on-chain.");
      toast.success(side === "buy" ? "Compra confirmada" : "Venta confirmada", {
        action: { label: "Ver", onClick: () => window.open(`${BSC_TESTNET.explorer}/tx/${hash}`, "_blank") },
      });
      setAmount("");
      // Refresh events, chart, volume, buys/sells and priceChange without a reload.
      curveQ.refetch();
      balanceQ.refetch();
      invalidateTradeCache(curve.curve as `0x${string}`);
      queryClient.invalidateQueries({ queryKey: ["curveTrades", curve.curve] });
      queryClient.invalidateQueries({ queryKey: ["curveStats", curve.curve] });
      queryClient.invalidateQueries({ queryKey: ["tokens", "onchain"] });


    } catch (e) {
      console.error("[labsbnb] trade failed", e);
      toast.error(describeTxError(e));
    } finally {
      setBusy(false);
    }
  }

  const inputUnit = side === "buy" ? "BNB" : `$${tokenTicker}`;
  const outUnit = side === "buy" ? `$${tokenTicker}` : "BNB";
  const label = curveQ.isLoading
    ? "Cargando bonding curve…"
    : errorMsg
      ? "No disponible"
      : side === "buy"
        ? t("token.buy")
        : t("token.sell");

  return (
    <div className="glass-strong rounded-2xl p-6">
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("buy")}
          className={
            side === "buy"
              ? "rounded-lg brand-gradient text-primary-foreground py-2 font-medium text-sm glow-primary"
              : "rounded-lg border border-white/10 bg-white/5 py-2 font-medium text-sm"
          }
        >
          {t("token.buy")}
        </button>
        <button
          onClick={() => setSide("sell")}
          className={
            side === "sell"
              ? "rounded-lg brand-gradient text-primary-foreground py-2 font-medium text-sm glow-primary"
              : "rounded-lg border border-white/10 bg-white/5 py-2 font-medium text-sm"
          }
        >
          {t("token.sell")}
        </button>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{side === "buy" ? "Pay with" : "Sell amount"}</span>
            {side === "sell" && balanceQ.data !== undefined && (
              <button className="hover:text-foreground" onClick={() => setAmount(formatEther(balanceQ.data!))}>
                Bal: {Number(formatEther(balanceQ.data)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-1">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.0"
              className="bg-transparent outline-none text-lg font-mono w-full"
            />
            <span className="text-sm font-medium">{inputUnit}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(side === "buy"
            ? [
                { label: "0.01", value: () => "0.01" },
                { label: "0.05", value: () => "0.05" },
                { label: "0.1", value: () => "0.1" },
                { label: "0.5", value: () => "0.5" },
              ]
            : [
                { label: "25%", value: () => fractionOfBalance(balanceQ.data, 25n) },
                { label: "50%", value: () => fractionOfBalance(balanceQ.data, 50n) },
                { label: "75%", value: () => fractionOfBalance(balanceQ.data, 75n) },
                { label: "MAX", value: () => fractionOfBalance(balanceQ.data, 100n) },
              ]
          ).map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const v = preset.value();
                if (v) setAmount(v);
              }}
              className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-white/10"
            >
              {preset.label}
            </button>
          ))}
        </div>


        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">You receive (est.)</div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-lg font-mono">
              {quoteQ.data
                ? Number(formatEther(quoteQ.data.out)).toLocaleString(undefined, { maximumFractionDigits: 6 })
                : "—"}
            </span>
            <span className="text-sm font-medium">{outUnit}</span>
          </div>
        </div>

        {side === "buy" && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Referrer (optional — 0.10%)</div>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="0x…"
              className="mt-1 bg-transparent outline-none text-xs font-mono w-full"
            />
          </div>
        )}

        <div className="text-[11px] text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Slippage</span><span>1.0%</span></div>
          {quoteQ.data && (
            <div className="flex justify-between">
              <span>Fee</span>
              <span>{Number(formatEther(quoteQ.data.fee)).toFixed(6)} BNB</span>
            </div>
          )}
          {curve && (
            <>
              <div className="flex justify-between"><span>Progress</span><span>{(curve.progressBps / 100).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span>Liquidity</span><span>{Number(formatEther(curve.liquidityWei)).toFixed(3)} BNB</span></div>
              <div className="flex justify-between"><span>Market cap</span><span>{Number(formatEther(curve.marketCapWei)).toFixed(3)} BNB</span></div>
            </>
          )}
          {ref && side === "buy" && <div className="flex justify-between"><span>Referral</span><span>0.10%</span></div>}
        </div>

        {errorMsg && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">{errorMsg}</div>}

        <button
          onClick={submit}
          disabled={busy || curveQ.isLoading || !!errorMsg}
          className="w-full rounded-xl brand-gradient text-primary-foreground py-3 font-semibold disabled:opacity-50"
        >
          {busy ? "Confirmando…" : label}
        </button>
        {curve && (
          <a
            href={`${BSC_TESTNET.explorer}/address/${curve.curve}`}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            curve {curve.curve.slice(0, 10)}…
          </a>
        )}
      </div>
    </div>
  );
}
