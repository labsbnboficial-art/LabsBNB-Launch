// Admin → Fees. Real-time on-chain dashboard for the treasury wallet:
// balance, totals, breakdown by operation and the last 20 fee transactions.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getFeeDashboard } from "@/lib/fees.functions";
import { saveAdminConfig } from "@/lib/config.functions";
import { FACTORY_ABI, BSC_TESTNET } from "@/lib/web3/abis";
import { ACTIVE_NETWORK, ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/config";
import { describeTxError, ensureChain } from "@/lib/web3/tx";
import { readClient } from "@/lib/web3/onchain-token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, ExternalLink, Wallet, TrendingUp, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  create: "Create Token",
  advanced: "Advanced Tokenomics",
  boost: "Boost (Impulso)",
};

const KIND_STYLE: Record<string, string> = {
  buy: "border-emerald-400/30 text-emerald-300",
  sell: "border-rose-400/30 text-rose-300",
  create: "border-sky-400/30 text-sky-300",
  advanced: "border-violet-400/30 text-violet-300",
  boost: "border-amber-400/30 text-amber-300",
};

function bnb(n: number) {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} BNB`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-primary">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AdminFeesTab({ csrf, cfg, onSaved }: {
  csrf: string;
  cfg: Record<string, unknown>;
  onSaved: () => void;
}) {
  const fetchFn = useServerFn(getFeeDashboard);
  const saveFn = useServerFn(saveAdminConfig);
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const factory = String(cfg["factory_address"] ?? "") || undefined;
  const [walletInput, setWalletInput] = useState(String(cfg["fee_wallet"] ?? ""));
  const [bpsInput, setBpsInput] = useState(String(cfg["fee_bps"] ?? "50"));
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["admin-fees", factory],
    queryFn: () => fetchFn({ data: { csrf, ...(factory ? { factory } : {}) } }),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const d = q.data?.ok ? q.data.data : null;
  const isOwner = !!(d && address && d.owner.toLowerCase() === address.toLowerCase());

  const kinds = useMemo(
    () => Object.entries(d?.byKind ?? {}).sort((a, b) => b[1] - a[1]),
    [d],
  );

  async function saveWallet() {
    setBusy(true);
    try {
      await saveFn({ data: { csrf, entries: [{ key: "fee_wallet", value: walletInput.trim(), is_public: true }] } });
      toast.success("Fee wallet guardada en la configuración.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  async function syncFeeBps() {
    if (!d) return;
    const bps = Number(bpsInput);
    if (!Number.isInteger(bps) || bps < 0 || bps > 500) return toast.error("El fee debe ser un entero entre 0 y 500 bps.");
    setBusy(true);
    try {
      await ensureChain(ACTIVE_CHAIN_ID, chainId, switchChainAsync, async () =>
        Number(await readClient().getChainId()),
      );
      const hash = await writeContractAsync({
        address: d.factory as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "setFee",
        args: [bps],
      });
      await saveFn({ data: { csrf, entries: [{ key: "fee_bps", value: bps, is_public: true }] } });
      toast.success(`setFee enviado: ${hash.slice(0, 12)}…`);
      onSaved();
      setTimeout(() => q.refetch(), 6000);
    } catch (e) {
      toast.error(describeTxError(e));
    } finally { setBusy(false); }
  }

  async function syncOnChain() {
    if (!d) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletInput.trim())) return toast.error("Dirección inválida.");
    setBusy(true);
    try {
      await ensureChain(ACTIVE_CHAIN_ID, chainId, switchChainAsync, async () =>
        Number(await readClient().getChainId()),
      );
      const hash = await writeContractAsync({
        address: d.factory as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "setFeeWallet",
        args: [walletInput.trim() as `0x${string}`],
      });
      toast.success(`Transacción enviada: ${hash.slice(0, 12)}…`);
      setTimeout(() => q.refetch(), 6000);
    } catch (e) {
      toast.error(describeTxError(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="glass-strong rounded-3xl p-6">
        <h2 className="font-display text-lg font-semibold">Red activa</h2>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {[
            ["Network", ACTIVE_NETWORK.name],
            ["Chain ID", String(ACTIVE_CHAIN_ID)],
            ["Factory", ACTIVE_NETWORK.contracts.factory ?? "not configured"],
            ["Fee wallet", ACTIVE_NETWORK.contracts.feeWallet ?? "-"],
            ["Treasury", ACTIVE_NETWORK.contracts.treasury ?? "-"],
            ["Owner", ACTIVE_NETWORK.contracts.owner ?? "-"],
            ["Router", ACTIVE_NETWORK.contracts.router ?? "-"],
            ["Explorer", ACTIVE_NETWORK.explorer],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="uppercase tracking-widest text-muted-foreground">{k}</span>
              <span className="font-mono break-all text-foreground">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-strong rounded-3xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Tesorería de comisiones</h2>
            <p className="text-xs text-muted-foreground">
              Datos leídos on-chain desde el Factory {d ? `${d.factory.slice(0, 10)}…` : ""} · actualización cada 20 s
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualizar
          </Button>
        </div>

        {q.data && !q.data.ok && (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {q.data.error}
          </p>
        )}

        {d && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <Wallet className="h-4 w-4 text-primary" />
              <a
                className="font-mono text-sm hover:text-primary"
                href={`${BSC_TESTNET.explorer}/address/${d.wallet}`}
                target="_blank"
                rel="noreferrer"
              >
                {d.wallet}
              </a>
              {d.walletMatches ? (
                <Badge variant="outline" className="border-emerald-400/30 text-emerald-300">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Wallet correcta y activa
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-400/30 text-amber-300">
                  <AlertTriangle className="mr-1 h-3 w-3" /> El contrato paga a otra wallet
                </Badge>
              )}
              <Badge variant="outline">Fee protocolo: {(d.feeBps / 100).toFixed(2)}%</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Saldo actual" value={bnb(d.balanceBnb)} />
              <Stat label="Total recibido" value={bnb(d.totals.all)} hint="Ventana on-chain + pagos registrados" />
              <Stat label="Hoy" value={bnb(d.totals.today)} />
              <Stat label="Últimos 7 días" value={bnb(d.totals.d7)} />
              <Stat label="Últimos 30 días" value={bnb(d.totals.d30)} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {kinds.map(([k, v]) => (
                <Badge key={k} variant="outline" className={KIND_STYLE[k] ?? ""}>
                  <TrendingUp className="mr-1 h-3 w-3" />
                  {KIND_LABEL[k] ?? k}: {bnb(v)}
                </Badge>
              ))}
            </div>
          </>
        )}

        {q.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Leyendo la blockchain…</p>}
      </div>

      {/* Wallet editor */}
      <div className="glass-strong rounded-3xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Wallet receptora de fees</h2>
        <Label className="text-xs uppercase tracking-widest text-muted-foreground">Dirección</Label>
        <Input value={walletInput} onChange={(e) => setWalletInput(e.target.value)} className="mt-1 font-mono" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={saveWallet} disabled={busy} variant="outline">Guardar en configuración</Button>
          <Button onClick={syncOnChain} disabled={busy || !isOwner} className="brand-gradient text-primary-foreground">
            Aplicar on-chain (setFeeWallet)
          </Button>
        </div>
        <div className="mt-6">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Comisión del protocolo (bps · máx. 500 = 5%)
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              type="number"
              value={bpsInput}
              onChange={(e) => setBpsInput(e.target.value)}
              className="max-w-[160px] font-mono"
            />
            <Button onClick={syncFeeBps} disabled={busy || !isOwner} variant="outline">
              Aplicar on-chain (setFee)
            </Button>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          El valor que realmente usan las curvas es el del contrato Factory
          {d ? ` (owner ${d.owner.slice(0, 10)}…)` : ""}. Conecta la wallet owner para poder aplicarlo on-chain;
          guardar en la base de datos sólo afecta a la interfaz y a los pagos directos (Impulso / Advanced Tokenomics).
        </p>
      </div>

      {/* Transactions */}
      <div className="glass-strong overflow-x-auto rounded-3xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Últimas 20 transacciones de fees</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-widest text-muted-foreground">
            <tr><th className="py-2">Fecha</th><th>Tipo</th><th>Monto</th><th>Hash</th><th /></tr>
          </thead>
          <tbody>
            {(d?.txs ?? []).map((t) => (
              <tr key={`${t.hash}-${t.kind}`} className="border-t border-white/5">
                <td className="whitespace-nowrap py-2">{new Date(t.timestamp).toLocaleString()}</td>
                <td>
                  <Badge variant="outline" className={KIND_STYLE[t.kind] ?? ""}>{KIND_LABEL[t.kind] ?? t.kind}</Badge>
                </td>
                <td className="font-mono text-primary">{bnb(t.amountBnb)}</td>
                <td className="font-mono text-xs">{t.hash.slice(0, 14)}…{t.hash.slice(-8)}</td>
                <td>
                  <a
                    className="inline-flex items-center gap-1 text-xs hover:text-primary"
                    href={`${BSC_TESTNET.explorer}/tx/${t.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    BscScan <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {d && d.txs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin comisiones en la ventana analizada (últimos {d.windowBlocks.toLocaleString()} bloques ≈ 7 días).
          </p>
        )}
      </div>
    </div>
  );
}
