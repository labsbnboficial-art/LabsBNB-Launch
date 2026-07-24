import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Realtime notifications for bonding-curve progress.
 * Toasts on milestone crossings (50%, 75%, 90%, 100%).
 */
const MILESTONES = [5000, 7500, 9000, 10000];

export function useBondingCurveNotifications(tokenName?: string, tokenId?: string) {
  useEffect(() => {
    if (!tokenId) return;
    let lastBps = 0;
    const channel = supabase
      .channel(`curve-${tokenId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bonding_curves", filter: `token_id=eq.${tokenId}` },
        (payload) => {
          const bps = Number((payload.new as { progress_bps?: number }).progress_bps ?? 0);
          const completed = Boolean((payload.new as { completed?: boolean }).completed);
          for (const m of MILESTONES) {
            if (lastBps < m && bps >= m) {
              toast.success(
                `${tokenName ?? "Token"} — bonding curve at ${(m / 100).toFixed(0)}%`,
                { description: m === 10000 ? "Migrating to PancakeSwap…" : undefined },
              );
            }
          }
          lastBps = bps;
          if (completed) toast.success(`${tokenName ?? "Token"} graduated 🚀`);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tokenId, tokenName]);
}

/** Global launchpad-wide realtime activity toaster (new tokens, big trades). */
export function useLaunchpadActivityToasts(enabled = false) {
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("launchpad-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tokens" },
        (payload) => {
          const t = payload.new as { name?: string; ticker?: string };
          toast(`New token: ${t.name ?? "?"} ($${t.ticker ?? "?"})`);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled]);
}
