// 🚀 Impulso — purchase modal shown on the token page (creator only).
// Flow: pick a plan → send a real BNB transfer to the treasury wallet →
// the server verifies the receipt on-chain and creates the boost row.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { parseEther } from "viem";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getBoostState, purchaseBoost } from "@/lib/boost.functions";
import { readClient } from "@/lib/web3/onchain-token";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/config";
import { describeTxError, ensureChain } from "@/lib/web3/tx";
import { BSC_TESTNET } from "@/lib/web3/abis";
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

  const { address: wallet, chainId } = useAccount();
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

    setBusy(true);
    try {
      setStep("Comprobando la red…");
      await ensureChain(ACTIVE_CHAIN_ID, chainId, switchChainAsync, async () =>
        Number(await readClient().getChainId()),
      );

      setStep("Firma el pago en tu wallet…");
      const txHash = await sendTransactionAsync({
        to: settings.wallet as `0x${string}`,
        value: parseEther(price.toFixed(8)),
      });

      setStep("Verificando el pago on-chain…");
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
      toast.error(describeTxError(e));
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
