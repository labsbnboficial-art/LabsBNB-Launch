import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { ACTIVE_CHAIN_ID, ACTIVE_NETWORK } from "@/lib/web3/networks";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/labsbnb/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { Rocket, Wallet, Loader2 } from "lucide-react";
import { siweChallenge, siweVerify } from "@/lib/siwe.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" && search.redirect.startsWith("/") ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in with wallet — LabsBNB Launchpad" },
      { name: "description", content: "Sign in to LabsBNB Launchpad using your Web3 wallet." },
      { property: "og:title", content: "Sign in — LabsBNB Launchpad" },
      { property: "og:description", content: "Wallet-only sign in with WalletConnect v2." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const onBsc = chainId === ACTIVE_CHAIN_ID;
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const target = redirect ?? "/";

  const challenge = useServerFn(siweChallenge);
  const verify = useServerFn(siweVerify);

  useEffect(() => { if (user) navigate({ to: target }); }, [user, navigate, target]);

  async function signIn() {
    if (!address) { toast.error("Connect a wallet first"); return; }
    setBusy(true);
    try {
      // Force BNB Smart Chain before signing (wallets often default to Ethereum).
      if (chainId !== ACTIVE_CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
        } catch {
          toast.error(`Please switch to ${ACTIVE_NETWORK.name} (chain ${ACTIVE_CHAIN_ID})`);
          return;
        }
      }
      const domain = typeof window !== "undefined" ? window.location.host : "labsbnb.app";
      const { message } = await challenge({ data: { address, domain, chainId: ACTIVE_CHAIN_ID } });
      const signature = await signMessageAsync({ message });
      const { token_hash } = await verify({ data: { address, message, signature } });
      // Passing `email` alongside `token_hash` makes Supabase answer
      // "Only the token_hash and type should be provided".
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });

      if (error) throw error;
      toast.success("Signed in");
      navigate({ to: target });
    } catch (e) {
      console.error(e);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="glass-strong rounded-3xl p-8">
          <div className="text-center mb-6">
            <div className="inline-flex h-12 w-12 rounded-xl brand-gradient glow-primary items-center justify-center">
              <Rocket className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold">{t("auth.title")}</h1>
            <p className="text-sm text-muted-foreground">Sign in with your Web3 wallet (SIWE).</p>
          </div>

          {!isConnected ? (
            <div className="space-y-2">
              {connectors.map((c) => (
                <Button
                  key={c.uid}
                  disabled={isPending}
                  onClick={() => connect({ connector: c })}
                  variant="outline"
                  className="w-full justify-start border-white/10 bg-white/5 hover:bg-white/10"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  {c.name}
                </Button>
              ))}
              <p className="mt-3 text-[11px] text-muted-foreground text-center">
                Compatible: MetaMask, Trust, Binance, OKX, Rabby, SafePal, Coinbase, Brave — via WalletConnect v2.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Connected wallet</div>
                <div className="font-mono text-sm mt-1 break-all">{address}</div>
                <div className="mt-2 text-[11px]">
                  {onBsc ? (
                    <span className="text-accent">Network: {ACTIVE_NETWORK.name} ({ACTIVE_CHAIN_ID})</span>
                  ) : (
                    <button
                      onClick={() => switchChainAsync({ chainId: ACTIVE_CHAIN_ID }).catch(() => toast.error("Could not switch network"))}
                      className="text-destructive underline underline-offset-2"
                    >
                      Wrong network (chain {chainId}) — switch to {ACTIVE_NETWORK.shortName}
                    </button>
                  )}
                </div>
              </div>
              <Button
                onClick={signIn}
                disabled={busy}
                className="w-full brand-gradient text-primary-foreground glow-primary"
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wallet className="h-4 w-4 mr-1.5" />}
                Sign message to log in
              </Button>
              <button
                onClick={() => disconnect()}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Use another wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
