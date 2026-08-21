import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { AlertTriangle, Loader2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_NETWORK,
  chainLabel,
  isCorrectChain,
  IS_TESTNET_ENV,
} from "@/lib/web3/networks";

/**
 * Global network state banner.
 * - Wrong network → professional "Wrong network" panel with a Switch button.
 * - Correct network on a testnet build → visible TESTNET notice (never hidden).
 * Purely presentational: it does not send transactions.
 */
export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const wrong = isConnected && !isCorrectChain(chainId);

  if (wrong) {
    return (
      <div className="sticky top-0 z-40 border-b border-destructive/30 bg-destructive/10 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Wrong network</div>
            <div className="text-xs text-muted-foreground">
              Please switch to BNB Smart Chain — Current: {chainLabel(chainId)} ({chainId}) ·
              Required: {ACTIVE_NETWORK.name} ({ACTIVE_NETWORK.chainId})
            </div>
          </div>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => switchChain({ chainId: ACTIVE_NETWORK.chainId })}
            className="brand-gradient text-primary-foreground"
          >
            {isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Switch Network
          </Button>
        </div>
      </div>
    );
  }

  if (!IS_TESTNET_ENV) return null;

  return (
    <div className="border-b border-amber-400/20 bg-amber-400/10">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-[11px] text-amber-200/90">
        <FlaskConical className="h-3.5 w-3.5" />
        <span className="font-semibold uppercase tracking-widest">Testnet</span>
        <span className="text-muted-foreground">
          Running on {ACTIVE_NETWORK.name} (chain {ACTIVE_NETWORK.chainId}). Tokens and balances
          have no real value.
        </span>
      </div>
    </div>
  );
}
