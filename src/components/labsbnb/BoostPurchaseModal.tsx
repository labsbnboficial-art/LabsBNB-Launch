// 🚀 Impulso — purchase modal shown on the token page (creator only).
// Flow: pick a plan → send a real BNB transfer to the treasury wallet →
// the server verifies the receipt on-chain and creates the boost row.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { formatEther, parseEther } from "viem";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getBoostState, purchaseBoost } from "@/lib/boost.functions";
import { readClient } from "@/lib/web3/onchain-token";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/config";
import { describeRpcError, describeWalletError, ensureChain, walletChainId } from "@/lib/web3/tx";
import { BSC_TESTNET } from "@/lib/web3/abis";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Rocket, Loader2, ExternalLink } from "lucide-react";

type Props = { token: `0x${string}`; name?: string | null; ticker?: string | null };

export function BoostPurchaseModal({ token, name, ticker }: Props) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");

  const { address: wallet, chainId, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const stateFn = useServerFn(getBoostState);
  const buyFn = useServerFn(purchaseBoost);
  const stateQ = useQuery({ queryKey: ["boost-state"], queryFn: () => stateFn() });

  const settings = stateQ.data?.settings;
  const packages = stateQ.data?.packages ?? [];

  const days = useMemo(() => {
    if (planId) return packages.find((p) => p.id === planId)?.days ?? 0;
    const n = Number(customDays);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [planId, customDays, packages]);

  const price = useMemo(() => {
    if (planId) return packages.find((p) => p.id === planId)?.priceBnb ?? 0;
    if (!settings || !days) return 0;
    return Number((days * settings.pricePerDayBnb).toFixed(8));
  }, [planId, packages, days, settings]);

  const maxDays = settings?.maxDays ?? 30;
  const invalidDays = !planId && (days < 1 || days > maxDays);

  async function purchase() {
    if (!wallet) return toast.error("Conecta tu wallet para impulsar el proyecto.");
    if (!settings?.enabled) return toast.error("El servicio Impulso está desactivado.");
    if (!days || price <= 0) return toast.error("Selecciona un plan o indica los días.");
    if (invalidDays) return toast.error(`Máximo ${maxDays} días por compra.`);

    const tag = "[IMPULSO_TX]";
    const to = settings.wallet as `0x${string}`;
    // Price in wei straight from the configured per-day price: never round-trip
    // through a JS float when building `value`.
    const value = planId
      ? parseEther(String(price))
      : parseEther(String(settings.pricePerDayBnb)) * BigInt(days);

    setBusy(true);
    try {
      console.info(tag, {
        connector: connector?.name,
        chainId,
        account: wallet,
        receiver: to,
        value: value.toString(),
        days,
        planId,
      });

      setStep("Comprobando la red…");
      // The chain must be re-read from the WALLET (a public client always
      // answers the active chain and would hide a wrong wallet network).
      await ensureChain(ACTIVE_CHAIN_ID, chainId, switchChainAsync, () => walletChainId(connector));
      const onChain = await walletChainId(connector);
      console.info(tag, "chainId after switch =", onChain);
      if (onChain !== undefined && onChain !== ACTIVE_CHAIN_ID) {
        throw new Error(`Tu wallet está en la red ${onChain}. Cambia a ${ACTIVE_NETWORK.name} (${ACTIVE_CHAIN_ID}).`);
      }

      setStep("Comprobando saldo y gas…");
      const rpc = readClient();
      const [balance, gasPrice] = await Promise.all([
        rpc.getBalance({ address: wallet as `0x${string}` }),
        rpc.getGasPrice(),
      ]);
      let gas = 21_000n;
      try {
        gas = await rpc.estimateGas({ account: wallet as `0x${string}`, to, value });
      } catch (e) {
        console.warn(tag, "estimateGas failed, using 21000", e);
      }
      const cost = value + gas * gasPrice;
      console.info(tag, {
        balance: balance.toString(),
        gas: gas.toString(),
        gasPrice: gasPrice.toString(),
        totalCost: cost.toString(),
      });
      if (balance < cost) {
        throw new Error(
          `Saldo insuficiente para cubrir el pago y el gas. Necesitas ~${formatEther(cost)} tBNB y tienes ${formatEther(balance)}.`,
        );
      }

      setStep("Firma el pago en tu wallet…");
      const txHash = await sendTransactionAsync({ to, value, gas: (gas * 125n) / 100n });
      console.info(tag, "txHash =", txHash);

      setStep("Esperando confirmación on-chain…");
      const receipt = await rpc.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
      console.info(tag, "receipt", { status: receipt.status, block: receipt.blockNumber?.toString() });
      if (receipt.status !== "success") {
        throw new Error(`La transacción ${txHash} falló on-chain. No se registró ningún impulso.`);
      }

      setStep("Registrando el impulso…");
      const res = await buyFn({
        data: {
          token,
          wallet,
          txHash,
          ...(planId ? { packageId: planId } : { days }),
        },
      });

      toast.success(
        res.status === "active"
          ? `🚀 Impulso activo hasta ${new Date(res.expires_at).toLocaleString()}`
          : "Pago verificado. El impulso queda pendiente de aprobación del administrador.",
      );
      queryClient.invalidateQueries({ queryKey: ["boost-state"] });
      setOpen(false);
    } catch (e) {
      const info = describeWalletError(e, {
        connector: connector?.name,
        chainId,
        account: wallet,
      });
      console.error("[IMPULSO_TX_ERROR]", { code: info.code, message: info.message, cause: info.chain });
      toast.error(
        describeRpcError(e, {
          action: "Impulso payment",
          chainId: ACTIVE_CHAIN_ID,
          walletChainId: chainId,
          account: wallet,
          to,
          value,
          connector: connector?.name,
        }),
      );
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="brand-gradient text-background">
          <Rocket className="mr-1.5 h-4 w-4" /> Impulsar proyecto
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">🚀 Impulsar {name || "proyecto"}</DialogTitle>
          <DialogDescription>
            Destaca ${ticker || "TOKEN"} en la portada del launchpad. El pago se envía en{" "}
            {settings?.currency ?? "BNB"} a la tesorería y se verifica on-chain.
          </DialogDescription>
        </DialogHeader>

        {stateQ.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando planes…</p>
        ) : !settings?.enabled ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            El servicio Impulso está desactivado por el administrador.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {packages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPlanId(p.id); setCustomDays(""); }}
                  className={`rounded-2xl border p-3 text-left transition ${
                    planId === p.id ? "border-primary bg-primary/10" : "border-white/10 hover:border-primary/40"
                  }`}
                >
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.days} días</p>
                  <p className="mt-1 font-mono text-sm text-primary">{p.priceBnb} {settings.currency}</p>
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground" htmlFor="boost-days">
                O elige los días (máx. {maxDays})
              </label>
              <Input
                id="boost-days"
                inputMode="numeric"
                placeholder={`Ej. 7 · ${settings.pricePerDayBnb} ${settings.currency}/día`}
                value={customDays}
                onChange={(e) => { setCustomDays(e.target.value.replace(/[^0-9]/g, "")); setPlanId(null); }}
                className="mt-1"
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-mono text-lg font-semibold text-primary">
                {price ? price : "—"} {settings.currency}
              </span>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Tesorería:{" "}
              <a
                className="inline-flex items-center gap-1 font-mono hover:text-primary"
                href={`${BSC_TESTNET.explorer}/address/${settings.wallet}`}
                target="_blank"
                rel="noreferrer"
              >
                {settings.wallet.slice(0, 10)}…{settings.wallet.slice(-6)} <ExternalLink className="h-3 w-3" />
              </a>
            </p>

            <Button className="w-full brand-gradient text-background" disabled={busy || !price} onClick={purchase}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              {busy ? step || "Procesando…" : `Pagar ${price || ""} ${settings.currency}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
