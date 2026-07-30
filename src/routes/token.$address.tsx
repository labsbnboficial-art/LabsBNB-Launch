import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Share2, ArrowLeftRight, ExternalLink, Users, Flame, Droplets, TrendingUp, MessageSquare, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useAccount } from "wagmi";
import { useSiweSignIn } from "@/lib/use-siwe";
import { fetchOnChainToken, isAddress, type OnChainToken } from "@/lib/web3/onchain-token";
import { fetchTradePage, fetchCurveStats, buildCandles, TIMEFRAMES, type TimeframeId } from "@/lib/web3/curve-events";
import { BSC_TESTNET } from "@/lib/web3/abis";
import { CandleChart } from "@/components/labsbnb/CandleChart";
import { TradePanel } from "@/components/labsbnb/TradePanel";




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
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(address);
        const q = supabase.from("tokens").select("*, bonding_curves(*)");
        const { data, error } = await (isUuid ? q.eq("id", address) : q.ilike("contract_address", address))
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

  // Bonding curve address (on-chain read first, database row as backup).
  const curveAddr = ((chain?.curve as string | null) ??
    ((dbRow?.bonding_curves as { contract_address?: string } | null)?.contract_address ?? null)) as
    | `0x${string}`
    | null;
  const curveOk = curveAddr && isAddress(curveAddr) ? (curveAddr as `0x${string}`) : null;

  // Recent trades — decoded straight from Trade(...) events, paginated by block range.
  const eventsQ = useInfiniteQuery({
    queryKey: ["curveTrades", curveOk],
    enabled: !!curveOk,
    refetchInterval: 15_000,
    retry: 1,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchTradePage(curveOk!, pageParam, 25),
    getNextPageParam: (last) => last.nextCursor,
  });

  // volume24h() / priceChange() / holders() — the contract's own views.
  const statsQ = useQuery({
    queryKey: ["curveStats", curveOk],
    enabled: !!curveOk,
    refetchInterval: 15_000,
    queryFn: () => fetchCurveStats(curveOk!),
  });

  const events = useMemo(() => {
    const all = (eventsQ.data?.pages ?? []).flatMap((p) => p.events);
    const seen = new Set<string>();
    return all
      .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
      .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
  }, [eventsQ.data]);

  const eventsError = eventsQ.error as Error | null;
  useEffect(() => {
    if (eventsError) console.error("[token] Trade events could not be read:", eventsError);
  }, [eventsError]);

  const analytics = useMemo(() => {
    const buys = events.filter((e) => e.isBuy).length;
    return {
      buys,
      sells: events.length - buys,
      holders: statsQ.data?.holders ?? chain?.holders ?? 0,
      volume24h: Number(statsQ.data?.volume24hWei ?? 0n) / 1e18,
      priceChange: Number(statsQ.data?.priceChangeBps ?? 0n) / 100,
    };
  }, [events, statsQ.data, chain]);

  const [timeframe, setTimeframe] = useState<TimeframeId>("15m");
  const tfSeconds = TIMEFRAMES.find((t) => t.id === timeframe)!.seconds;
  const candles = useMemo(() => buildCandles(events, tfSeconds), [events, tfSeconds]);

  // Infinite scroll sentinel for the trades table.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && eventsQ.hasNextPage && !eventsQ.isFetchingNextPage) {
        eventsQ.fetchNextPage();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [eventsQ.hasNextPage, eventsQ.isFetchingNextPage, eventsQ.fetchNextPage, events.length]);


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
  const curveAddress: string | null = curveAddr;



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
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Price chart</div>
              {chartData.length > 1 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" minTickGap={24} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        width={70}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => v.toPrecision(3)}
                      />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                        formatter={(v: number) => [`${v.toPrecision(6)} BNB`, "Price"]}
                      />
                      <Area type="monotone" dataKey="price" stroke="hsl(var(--primary))" fill="url(#priceFill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 rounded-xl border border-dashed border-white/10 grid place-items-center text-sm text-muted-foreground">
                  {eventsQ.isLoading ? "Loading on-chain trades…" : "Waiting for on-chain trades to populate the chart."}
                </div>
              )}
            </div>

            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <ArrowLeftRight className="h-4 w-4 text-accent" />
                <h3 className="font-display text-lg font-semibold">Recent trades</h3>
              </div>
              {events.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-2 font-normal">Wallet</th>
                        <th className="py-2 font-normal">Type</th>
                        <th className="py-2 font-normal text-right">BNB</th>
                        <th className="py-2 font-normal text-right">Tokens</th>
                        <th className="py-2 font-normal text-right">Price</th>
                        <th className="py-2 font-normal text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {[...events].reverse().slice(0, 30).map((tr) => (
                        <tr key={tr.key}>
                          <td className="py-2 font-mono">
                            <a
                              href={`${BSC_TESTNET.explorer}/tx/${tr.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-foreground text-muted-foreground"
                            >
                              {tr.trader.slice(0, 6)}…{tr.trader.slice(-4)}
                            </a>
                          </td>
                          <td className={tr.isBuy ? "py-2 uppercase text-success" : "py-2 uppercase text-destructive"}>
                            {tr.isBuy ? "Buy" : "Sell"}
                          </td>
                          <td className="py-2 text-right font-mono">{(Number(tr.amountBnb) / 1e18).toFixed(4)}</td>
                          <td className="py-2 text-right font-mono">
                            {(Number(tr.amountTokens) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 text-right font-mono">{(Number(tr.price) / 1e18).toPrecision(4)}</td>
                          <td className="py-2 text-right text-muted-foreground">
                            {new Date(tr.timestamp * 1000).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
                  {eventsQ.isLoading ? "Loading on-chain trades…" : t("empty.noTrades")}
                </div>
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

            <TradePanel
              tokenTicker={tk.ticker}
              tokenAddress={(tk.contract_address as string | null) ?? (isAddress(address) ? address : null)}
              curveAddress={curveAddress}
            />

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
