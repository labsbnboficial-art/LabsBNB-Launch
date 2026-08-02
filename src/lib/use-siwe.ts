// Shared SIWE sign-in: challenge → wallet signature → Supabase session.
// Used by /auth and by the create flow (to save a token profile after deploy).
import { useCallback } from "react";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { useServerFn } from "@tanstack/react-start";
import { bscTestnet } from "wagmi/chains";
import { supabase } from "@/integrations/supabase/client";
import { siweChallenge, siweVerify } from "@/lib/siwe.functions";

export function useSiweSignIn() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const challenge = useServerFn(siweChallenge);
  const verify = useServerFn(siweVerify);

  /** Returns the signed-in Supabase user, signing in with the wallet if needed. */
  return useCallback(async () => {
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.user) return existing.session.user;
    if (!address) throw new Error("Connect a wallet first");

    try { await switchChainAsync({ chainId: bscTestnet.id }); } catch { /* already on it or refused */ }

    const domain = typeof window !== "undefined" ? window.location.host : "labsbnb.app";
    const { message } = await challenge({ data: { address, domain, chainId: bscTestnet.id } });
    const signature = await signMessageAsync({ message });
    const { token_hash } = await verify({ data: { address, message, signature } });
    // Supabase rejects `email` + `token_hash` together with
    // "Only the token_hash and type should be provided".
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });

    if (error) throw error;
    if (!data.session?.user) throw new Error("Session was not created");
    return data.session.user;
  }, [address, challenge, verify, signMessageAsync, switchChainAsync]);
}
