import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Copy, Share2, ArrowLeftRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/token/$address")({
  head: ({ params }) => ({
    meta: [
      { title: `Token ${params.address.slice(0, 10)} — LabsBNB Launchpad` },
      { name: "description", content: "Trade this token on the LabsBNB Launchpad bonding curve." },
      { property: "og:title", content: `Token ${params.address.slice(0, 10)}` },
      { property: "og:description", content: "Trade on LabsBNB Launchpad." },
    ],
  }),
  component: TokenPage,
});

function TokenPage() {
  const { address } = Route.useParams();
  const { t } = useI18n();

  const tokenQ = useQuery({
    queryKey: ["token", address],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tokens")
        .select("*, bonding_curves(*)")
        .or(`id.eq.${address},contract_address.eq.${address}`)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data;
    },
  });

  const tradesQ = useQuery({
    queryKey: ["trades", tokenQ.data?.id],
    enabled: !!tokenQ.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("token_id", tokenQ.data!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (tokenQ.isLoading) {
    return <AppShell><div className="max-w-6xl mx-auto px-6 py-16"><div className="glass rounded-2xl p-10 animate-pulse h-64" /></div></AppShell>;
  }
  if (!tokenQ.data) {
    return <AppShell><div className="max-w-6xl mx-auto px-6 py-16 text-center text-muted-foreground">{t("token.notFound")}</div></AppShell>;
  }
  const tk = tokenQ.data;
  const curve = (tk.bonding_curves as unknown as { progress_bps: number; target_bnb: string } | null) ?? null;
  const progress = curve ? Math.min(100, curve.progress_bps / 100) : 0;

  return (
    <AppShell>
      {/* Banner */}
      <div className="relative h-40 md:h-56 overflow-hidden">
        {tk.banner_url ? (
          <img src={tk.banner_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full hero-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl px-4 md:px-6 -mt-16 relative z-10">
        {/* Header */}
        <div className="glass-strong rounded-3xl p-6 flex flex-col md:flex-row gap-5 md:items-center">
          {tk.logo_url ? (
            <img src={tk.logo_url} alt="" className="h-20 w-20 rounded-2xl object-cover glow-primary" />
          ) : (
            <div className="h-20 w-20 rounded-2xl brand-gradient grid place-items-center font-display text-3xl font-bold text-primary-foreground glow-primary">
              {tk.ticker[0]}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl md:text-3xl font-bold">{tk.name}</h1>
              <span className="font-mono text-sm text-accent">${tk.ticker}</span>
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                {tk.status}
              </span>
            </div>
            {tk.description && <p className="mt-2 text-sm text-muted-foreground max-w-2xl">{tk.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                onClick={() => { navigator.clipboard.writeText(tk.contract_address ?? tk.id); toast.success("Copied"); }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono hover:bg-white/10"
              >
                <Copy className="h-3 w-3" />
                {(tk.contract_address ?? tk.id).slice(0, 10)}…
              </button>
              {tk.website && <SocialLink href={tk.website} label="Web" />}
              {tk.twitter && <SocialLink href={tk.twitter} label="X" />}
              {tk.telegram && <SocialLink href={tk.telegram} label="TG" />}
              {tk.discord && <SocialLink href={tk.discord} label="DC" />}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => { navigator.share?.({ url: location.href }).catch(() => {}); }}>
              <Share2 className="h-4 w-4 mr-1.5" /> {t("token.share")}
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Chart placeholder */}
            <div className="glass rounded-2xl p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Chart</div>
              <div className="h-64 rounded-xl border border-dashed border-white/10 grid place-items-center text-sm text-muted-foreground">
                Waiting for on-chain trades to populate the chart.
              </div>
            </div>
            {/* Trades */}
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <ArrowLeftRight className="h-4 w-4 text-accent" />
                <h3 className="font-display text-lg font-semibold">Recent trades</h3>
              </div>
              {tradesQ.data && tradesQ.data.length > 0 ? (
                <div className="text-sm divide-y divide-white/5">
                  {tradesQ.data.map((tr) => (
                    <div key={tr.id} className="flex items-center justify-between py-2">
                      <span className={tr.side === "buy" ? "text-success" : "text-destructive"}>{tr.side}</span>
                      <span className="font-mono text-xs">{tr.wallet_address.slice(0, 8)}…</span>
                      <span className="font-mono text-xs">{Number(tr.amount_bnb) / 1e18} BNB</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
                  {t("empty.noTrades")}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {/* Curve progress */}
            <div className="glass rounded-2xl p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{t("token.progress")}</div>
              <div className="font-display text-3xl font-bold text-gradient">{progress.toFixed(1)}%</div>
              <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full brand-gradient animate-pulse-glow" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Target: <span className="font-mono text-foreground">
                  {curve ? (Number(BigInt(curve.target_bnb)) / 1e18).toFixed(2) : "—"} BNB
                </span>
              </div>
            </div>

            {/* Trade panel */}
            <div className="glass-strong rounded-2xl p-6">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button className="rounded-lg brand-gradient text-primary-foreground py-2 font-medium text-sm glow-primary">
                  {t("token.buy")}
                </button>
                <button className="rounded-lg border border-white/10 bg-white/5 py-2 font-medium text-sm">
                  {t("token.sell")}
                </button>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pay with</div>
                  <div className="flex items-center justify-between mt-1">
                    <input placeholder="0.0" className="bg-transparent outline-none text-lg font-mono w-full" />
                    <span className="text-sm font-medium">BNB</span>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">You receive (est.)</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-lg font-mono text-muted-foreground">—</span>
                    <span className="text-sm font-medium">${tk.ticker}</span>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <div className="flex justify-between"><span>Slippage</span><span>1.0%</span></div>
                  <div className="flex justify-between"><span>Fee</span><span>0.50%</span></div>
                </div>
                <button
                  disabled
                  className="w-full rounded-xl brand-gradient text-primary-foreground py-3 font-semibold disabled:opacity-50"
                  title="Enabled once the on-chain factory is wired (Phase 2)"
                >
                  Confirm — pending contract
                </button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground text-center">
              <Link to="/" className="hover:text-foreground">← back to launchpad</Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10">
      {label}<ExternalLink className="h-3 w-3" />
    </a>
  );
}
