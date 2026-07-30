import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Share2, ArrowLeftRight, ExternalLink, Users, Flame, Droplets, TrendingUp, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { fetchOnChainToken, isAddress, type OnChainToken } from "@/lib/web3/onchain-token";


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
  const { user } = useAuth();

  const tokenQ = useQuery({
    queryKey: ["token", address],
    retry: 1,
    queryFn: async () => {
      // 1) Try the database first.
      let row: Record<string, unknown> | null = null;
      try {
        const { data, error } = await supabase
          .from("tokens")
          .select("*, bonding_curves(*)")
          .or(`id.eq.${address},contract_address.eq.${address}`)
          .maybeSingle();
        if (error) throw error;
        row = data as Record<string, unknown> | null;
      } catch (e) {
        console.error("[token] database lookup failed, falling back on-chain", e);
      }
      // 2) Fall back to the blockchain so a deployed token is never "lost".
      let chain: OnChainToken | null = null;
      if (!row && isAddress(address)) {
        chain = await fetchOnChainToken(address);
      }
      if (!row && !chain) throw notFound();
      return { row, chain };
    },
  });

  const dbRow = tokenQ.data?.row as any;
  const chain = tokenQ.data?.chain ?? null;

  const tradesQ = useQuery({
    queryKey: ["trades", dbRow?.id],
    enabled: !!dbRow?.id,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("token_id", dbRow.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const commentsQ = useQuery({
    queryKey: ["comments", dbRow?.id],
    enabled: !!dbRow?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("comments")
        .select("id,content,created_at,user_id")
        .eq("token_id", dbRow.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const analytics = useMemo(() => {
    const list = tradesQ.data ?? [];
    if (!list.length) {
      return chain
        ? { holders: chain.holders, volume24h: Number(BigInt(chain.volume24hWei)) / 1e18, priceChange: 0, buys: 0, sells: 0 }
        : { holders: 0, volume24h: 0, priceChange: 0, buys: 0, sells: 0 };
    }
    const holders = new Set(list.map((t) => t.wallet_address.toLowerCase())).size;
    const now = Date.now();
    const dayCut = now - 24 * 3600_000;
    const vol24 = list.filter((t) => new Date(t.created_at).getTime() >= dayCut).reduce((s, t) => s + Number(t.amount_bnb) / 1e18, 0);
    const buys = list.filter((t) => t.side === "buy").length;
    const sells = list.length - buys;
    const priceNow = Number(list[0]?.price ?? 0);
    const priceThen = Number(list.find((t) => new Date(t.created_at).getTime() < dayCut)?.price ?? priceNow);
    const priceChange = priceThen > 0 ? ((priceNow - priceThen) / priceThen) * 100 : 0;
    return { holders, volume24h: vol24, priceChange, buys, sells };
  }, [tradesQ.data, chain]);

  if (tokenQ.isLoading) {
    return <AppShell><div className="max-w-6xl mx-auto px-6 py-16"><div className="glass rounded-2xl p-10 animate-pulse h-64" /></div></AppShell>;
  }
  if (!dbRow && !chain) {
    return <AppShell><div className="max-w-6xl mx-auto px-6 py-16 text-center text-muted-foreground">{t("token.notFound")}</div></AppShell>;
  }

  // Unified view model — database row when available, on-chain data otherwise.
  const tk = dbRow ?? {
    id: chain!.address,
    name: chain!.name,
    ticker: chain!.ticker,
    description: null,
    logo_url: null,
    banner_url: null,
    website: chain!.metadataURI && /^https?:\/\//.test(chain!.metadataURI) ? chain!.metadataURI : null,
    twitter: null,
    telegram: null,
    discord: null,
    status: "on-chain",
    creator_id: chain!.creator ?? "unknown",
    contract_address: chain!.address,
  };
  type CurveView = { progress_bps: number; target_bnb: string; virtual_bnb?: string; real_bnb?: string };
  const curve: CurveView | null = dbRow
    ? ((dbRow.bonding_curves as unknown as CurveView | null) ?? null)
    : chain!.curve
      ? { progress_bps: chain!.progressBps, target_bnb: chain!.targetBnbWei, real_bnb: chain!.realLiquidityWei }
      : null;
  const progress = curve ? Math.min(100, curve.progress_bps / 100) : 0;


  return (
    <AppShell>
      <div className="relative h-40 md:h-56 overflow-hidden">
        {tk.banner_url ? (
          <img src={tk.banner_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full hero-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl px-4 md:px-6 -mt-16 relative z-10">
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
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{tk.status}</span>
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">creator: {String(tk.creator_id).slice(0, 8)}…</span>
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

        {/* Analytics strip */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="24h Volume" value={`${analytics.volume24h.toFixed(3)} BNB`} />
          <StatCard icon={<Users className="h-3.5 w-3.5" />} label="Holders" value={analytics.holders} />
          <StatCard icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Buys / Sells" value={`${analytics.buys}/${analytics.sells}`} />
          <StatCard icon={<Flame className="h-3.5 w-3.5" />} label="24h Change" value={`${analytics.priceChange >= 0 ? "+" : ""}${analytics.priceChange.toFixed(2)}%`} accent={analytics.priceChange >= 0 ? "text-success" : "text-destructive"} />
          <StatCard icon={<Droplets className="h-3.5 w-3.5" />} label="Liquidity" value={curve ? `${(Number(BigInt(curve.real_bnb ?? "0")) / 1e18).toFixed(3)} BNB` : "—"} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass rounded-2xl p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Chart</div>
              <div className="h-64 rounded-xl border border-dashed border-white/10 grid place-items-center text-sm text-muted-foreground">
                Waiting for on-chain trades to populate the chart.
              </div>
            </div>

            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <ArrowLeftRight className="h-4 w-4 text-accent" />
                <h3 className="font-display text-lg font-semibold">Recent trades</h3>
              </div>
              {tradesQ.data && tradesQ.data.length > 0 ? (
                <div className="text-sm divide-y divide-white/5">
                  {tradesQ.data.slice(0, 30).map((tr) => (
                    <div key={tr.id} className="flex items-center justify-between py-2">
                      <span className={tr.side === "buy" ? "text-success uppercase text-xs" : "text-destructive uppercase text-xs"}>{tr.side}</span>
                      <span className="font-mono text-xs">{tr.wallet_address.slice(0, 8)}…</span>
                      <span className="font-mono text-xs">{(Number(tr.amount_bnb) / 1e18).toFixed(4)} BNB</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(tr.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">{t("empty.noTrades")}</div>
              )}
            </div>

            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h3 className="font-display text-lg font-semibold">Comments</h3>
              </div>
              {user ? (
                <CommentBox tokenId={tk.id} onSent={() => commentsQ.refetch()} />
              ) : (
                <p className="text-xs text-muted-foreground mb-4">Sign in to comment.</p>
              )}
              <ul className="divide-y divide-white/5">
                {(commentsQ.data ?? []).map((c) => (
                  <li key={c.id} className="py-3 flex gap-3">
                    <div className="h-8 w-8 rounded-full brand-gradient shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground font-mono">{c.user_id.slice(0, 8)}… · {new Date(c.created_at).toLocaleString()}</div>
                      <div className="text-sm mt-0.5 break-words">{c.content}</div>
                    </div>
                  </li>
                ))}
                {(commentsQ.data ?? []).length === 0 && <li className="py-6 text-center text-xs text-muted-foreground">No comments yet.</li>}
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass rounded-2xl p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{t("token.progress")}</div>
              <div className="font-display text-3xl font-bold text-gradient">{progress.toFixed(1)}%</div>
              <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full brand-gradient animate-pulse-glow" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Target: <span className="font-mono text-foreground">{curve ? (Number(BigInt(curve.target_bnb)) / 1e18).toFixed(2) : "—"} BNB</span>
              </div>
              {curve?.virtual_bnb && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Virtual: <span className="font-mono">{(Number(BigInt(curve.virtual_bnb)) / 1e18).toFixed(2)}</span>
                </div>
              )}
            </div>

            <TradePanel tokenTicker={tk.ticker} />

            <div className="text-xs text-muted-foreground text-center">
              <Link to="/" className="hover:text-foreground">← back to launchpad</Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 font-display font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function TradePanel({ tokenTicker }: { tokenTicker: string }) {
  const { t } = useI18n();
  const [ref, setRef] = useState("");
  return (
    <div className="glass-strong rounded-2xl p-6">
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button className="rounded-lg brand-gradient text-primary-foreground py-2 font-medium text-sm glow-primary">{t("token.buy")}</button>
        <button className="rounded-lg border border-white/10 bg-white/5 py-2 font-medium text-sm">{t("token.sell")}</button>
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
            <span className="text-sm font-medium">${tokenTicker}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Referrer (optional — 0.10%)</div>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="0x…" className="mt-1 bg-transparent outline-none text-xs font-mono w-full" />
        </div>
        <div className="text-[11px] text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Slippage</span><span>1.0%</span></div>
          <div className="flex justify-between"><span>Protocol fee</span><span>0.30%</span></div>
          <div className="flex justify-between"><span>Creator fee</span><span>0.20%</span></div>
          {ref && <div className="flex justify-between"><span>Referral</span><span>0.10%</span></div>}
        </div>
        <button disabled className="w-full rounded-xl brand-gradient text-primary-foreground py-3 font-semibold disabled:opacity-50" title="Enabled once the on-chain factory is wired">
          Confirm — pending contract
        </button>
      </div>
    </div>
  );
}

function CommentBox({ tokenId, onSent }: { tokenId: string; onSent: () => void }) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!body.trim() || !user) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("comments").insert({ token_id: tokenId, content: body.trim(), user_id: user.id });
      if (error) throw error;
      setBody("");
      onSent();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mb-4 flex gap-2">
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say something…" />
      <Button onClick={send} disabled={busy} className="brand-gradient text-primary-foreground">Post</Button>
    </div>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10">
      {label}<ExternalLink className="h-3 w-3" />
    </a>
  );
}
