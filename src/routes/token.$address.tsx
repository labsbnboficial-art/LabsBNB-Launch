import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { SOCIAL_FIELDS, type SocialKey } from "@/lib/social";
import { SocialLinks } from "@/components/labsbnb/SocialLinks";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Share2, ArrowLeftRight, ExternalLink, Users, Flame, Droplets, TrendingUp, MessageSquare, AlertTriangle, Crown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useAccount } from "wagmi";
import { useSiweSignIn } from "@/lib/use-siwe";
import { fetchOnChainToken, isAddress, type OnChainToken } from "@/lib/web3/onchain-token";
import { fetchTradePage, fetchCurveStats, buildCandles, TIMEFRAMES, type TimeframeId } from "@/lib/web3/curve-events";
import { fetchLivePrice, formatPrice } from "@/lib/web3/live-price";
import { computeAth, distanceFromAth, formatAthDate } from "@/lib/web3/ath";

import { BSC_TESTNET } from "@/lib/web3/abis";
import { CandleChart } from "@/components/labsbnb/CandleChart";
import { TradePanel } from "@/components/labsbnb/TradePanel";
import { useServerFn } from "@tanstack/react-start";
import { ensureTokenRow } from "@/lib/tokens.functions";
import { updateTokenMeta } from "@/lib/token-meta.functions";
import { fetchTopHolders } from "@/lib/web3/holders";
import { Textarea } from "@/components/ui/textarea";
import { uploadTokenMedia } from "@/lib/media.functions";
import { uploadTokenImage } from "@/lib/image-upload";
import { tokenMediaUrl } from "@/lib/media-url";
import { BoostPurchaseModal } from "@/components/labsbnb/BoostPurchaseModal";






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
  const { address: wallet } = useAccount();

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
      // 2) ALWAYS read the chain too: the database row may exist without a
      // `bonding_curves` record, and without the curve address every live
      // metric (price, liquidity, trades, chart) stays empty.
      const target = (isAddress(address)
        ? address
        : ((row?.["contract_address"] as string | undefined) ?? "")) as string;
      let chain: OnChainToken | null = null;
      if (isAddress(target)) chain = await fetchOnChainToken(target);
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

  // Live market price: currentPrice() while the curve is active, PancakeSwap
  // pair reserves once it graduated. Refreshed every 3s and on tab focus.
  const liveQ = useQuery({
    queryKey: ["curveLive", curveOk],
    enabled: !!curveOk,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: () => fetchLivePrice(curveOk!, (isAddress(address) ? address : (chain?.address ?? null)) as `0x${string}` | null),
  });
  const live = liveQ.data ?? null;

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

  // Every time the chain head moves, refresh the trades feed so the chart and
  // the table follow the live price without a page reload.
  const queryClient = useQueryClient();
  const lastBlock = useRef<bigint>(0n);
  useEffect(() => {
    if (!live?.blockNumber || !curveOk) return;
    if (lastBlock.current === 0n) {
      lastBlock.current = live.blockNumber;
      return;
    }
    if (live.blockNumber > lastBlock.current) {
      lastBlock.current = live.blockNumber;
      queryClient.invalidateQueries({ queryKey: ["curveTrades", curveOk] });
    }
  }, [live?.blockNumber, curveOk, queryClient]);

  const analytics = useMemo(() => {
    const buys = events.filter((e) => e.isBuy).length;
    const buyVol = events.filter((e) => e.isBuy).reduce((a, e) => a + Number(e.amountBnb) / 1e18, 0);
    const sellVol = events.filter((e) => !e.isBuy).reduce((a, e) => a + Number(e.amountBnb) / 1e18, 0);
    const buyers = new Set(events.filter((e) => e.isBuy).map((e) => e.trader.toLowerCase())).size;
    const sellers = new Set(events.filter((e) => !e.isBuy).map((e) => e.trader.toLowerCase())).size;
    return {
      buys,
      sells: events.length - buys,
      buyVol,
      sellVol,
      buyers,
      sellers,
      holders: live?.holders ?? statsQ.data?.holders ?? chain?.holders ?? 0,
      volume24h: Number(live?.volume24hWei ?? statsQ.data?.volume24hWei ?? 0n) / 1e18,
      priceChange: (live?.priceChangeBps ?? Number(statsQ.data?.priceChangeBps ?? 0)) / 100,
    };
  }, [events, statsQ.data, chain, live]);

  // ATH computed from the real Trade(...) history loaded above.
  const ath = useMemo(() => computeAth(events), [events]);
  const fromAth = distanceFromAth(live?.priceWei ?? null, ath?.priceWei ?? null);


  const [timeframe, setTimeframe] = useState<TimeframeId>("15m");
  const tfSeconds = TIMEFRAMES.find((t) => t.id === timeframe)!.seconds;
  const allCandles = useMemo(() => buildCandles(events, tfSeconds), [events, tfSeconds]);

  // Zoom / visible range: how many of the most recent candles are drawn.
  // The chart itself also drives this via wheel / pinch.
  const [visibleCount, setVisibleCount] = useState(90);
  const zoom = (dir: 1 | -1) =>
    setVisibleCount((n) => Math.min(600, Math.max(15, Math.round(dir === 1 ? n / 1.4 : n * 1.4))));


  // Keep the chart and the trades list on the same temporal range: when the
  // selected timeframe needs more history than the loaded pages cover, pull
  // older pages (bounded) so candles and rows always describe the same window.
  const targetWindow = tfSeconds * visibleCount;
  const [autoPages, setAutoPages] = useState(0);
  useEffect(() => setAutoPages(0), [timeframe, curveOk, visibleCount]);
  useEffect(() => {
    if (eventsQ.isFetching || !eventsQ.hasNextPage) return;
    if (autoPages >= 10) return;
    // An empty first page just means the curve has been idle: keep scanning back.
    if (events.length) {
      const oldest = events[0].timestamp;
      const newest = events[events.length - 1].timestamp;
      if (newest - oldest >= targetWindow) return;
    }
    setAutoPages((n) => n + 1);
    eventsQ.fetchNextPage();
  }, [events, targetWindow, autoPages, eventsQ.hasNextPage, eventsQ.isFetching, eventsQ.fetchNextPage, curveOk]);


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



  // A token that only lives on-chain gets its row created on first comment;
  // keep that id so the thread loads right away (before it existed, the list
  // stayed disabled and the new comment looked lost).
  const [resolvedTokenId, setResolvedTokenId] = useState<string | null>(null);
  const commentTokenId = (dbRow?.id ? String(dbRow.id) : null) ?? resolvedTokenId;

  const commentsQ = useQuery({
    queryKey: ["comments", commentTokenId],
    enabled: !!commentTokenId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comments")
        .select("id,content,created_at,user_id")
        .eq("token_id", commentTokenId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Missions CTA (creator only): needs a database row, so an on-chain-only
  // token is claimed/created on the fly before opening the campaign builder.
  const navigate = useNavigate();
  const ensureRowForMissions = useServerFn(ensureTokenRow);
  const siweForMissions = useSiweSignIn();
  const [missionsBusy, setMissionsBusy] = useState(false);


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
  // Live values win over anything cached in the database.
  const progress = live
    ? Math.min(100, live.progressBps / 100)
    : curve
      ? Math.min(100, curve.progress_bps / 100)
      : 0;
  const liquidityBnb = live
    ? Number(live.liquidityWei) / 1e18
    : curve
      ? Number(BigInt(curve.real_bnb ?? "0")) / 1e18
      : null;
  const marketCapBnb = live ? Number(live.marketCapWei) / 1e18 : null;
  const curveAddress: string | null = curveAddr;

  // Social links: database first (the creator can edit them), falling back to
  // the on-chain metadata URI when the row does not exist yet.
  const socialSource = (dbRow ?? tk) as Record<string, unknown>;
  const socialValues = Object.fromEntries(
    SOCIAL_FIELDS.map((f) => [f.key, ((socialSource[f.key] as string | null) ?? "") || ""]),
  ) as Record<SocialKey, string>;
  if (!socialValues.website && tk.website) socialValues.website = tk.website as string;

  // The creator can edit the profile both when the database row exists and when
  // the token only lives on-chain (the row is created on the first save).
  const isCreator =
    (!!user && !!dbRow?.creator_id && user.id === dbRow.creator_id) ||
    (!!wallet && !!chain?.creator && wallet.toLowerCase() === chain.creator.toLowerCase());



  return (
    <AppShell>
      <div className="relative h-40 md:h-56 overflow-hidden">
        {tokenMediaUrl(tk.banner_url) ? (
          <img src={tokenMediaUrl(tk.banner_url) ?? ""} alt={`${tk.name} banner`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full hero-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl px-4 md:px-6 -mt-16 relative z-10">
        <div className="glass-strong rounded-3xl p-6 flex flex-col md:flex-row gap-5 md:items-center">
          {tokenMediaUrl(tk.logo_url) ? (
            <img src={tokenMediaUrl(tk.logo_url) ?? ""} alt={`${tk.name} logo`} className="h-20 w-20 rounded-2xl object-cover glow-primary" />
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
              <SocialLinks values={socialValues} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isCreator && isAddress(tk.contract_address ?? "") && (
              <BoostPurchaseModal
                token={(tk.contract_address as string) as `0x${string}`}
                name={tk.name}
                ticker={tk.ticker}
              />
            )}
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => { navigator.share?.({ url: location.href }).catch(() => {}); }}>
              <Share2 className="h-4 w-4 mr-1.5" /> {t("token.share")}
            </Button>
          </div>

        </div>




        {/* Live price */}
        <div className="mt-6 glass-strong rounded-2xl p-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${liveQ.isFetching ? "bg-accent" : "bg-success"} animate-pulse`} />
              Precio en vivo
              <span className="rounded-full bg-white/5 px-2 py-0.5 normal-case tracking-normal">
                {live?.source === "pancake" ? "PancakeSwap" : "Bonding curve"}
              </span>
            </div>
            <div className="mt-1 font-display text-3xl font-bold font-mono tabular-nums">
              {live ? `${formatPrice(live.priceWei)} BNB` : "—"}
            </div>
            <div className={`mt-0.5 text-xs font-mono ${analytics.priceChange >= 0 ? "text-success" : "text-destructive"}`}>
              {analytics.priceChange >= 0 ? "+" : ""}
              {analytics.priceChange.toFixed(2)}% 24h
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Market cap · <span className="font-mono text-foreground">{marketCapBnb != null ? `${marketCapBnb.toFixed(4)} BNB` : "N/A"}</span></div>
            <div>Liquidez · <span className="font-mono text-foreground">{liquidityBnb != null ? `${liquidityBnb.toFixed(4)} BNB` : "N/A"}</span></div>
            <div className="mt-1 inline-flex flex-col items-end rounded-xl border border-[oklch(0.83_0.14_85_/_0.3)] bg-[oklch(0.83_0.14_85_/_0.07)] px-3 py-1.5">
              <span className="text-[9px] uppercase tracking-[0.16em] text-gold">ATH</span>
              <span className="font-mono text-sm text-gold">{ath ? `${formatPrice(ath.priceWei)} BNB` : "N/A"}</span>
              <span className="font-mono text-[10px]">
                {fromAth == null ? "N/A" : `${fromAth >= 0 ? "+" : ""}${fromAth.toFixed(1)}% from ATH`}
              </span>
            </div>
            {live?.migrated && live.pair && (
              <a
                className="mt-1 flex items-center justify-end gap-1 hover:text-foreground"
                href={`${BSC_TESTNET.explorer}/address/${live.pair}`}
                target="_blank"
                rel="noreferrer"
              >
                Par PancakeSwap <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* ATH — computed from the real Trade(...) history */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={<Crown className="h-3.5 w-3.5" />} label="ATH price" value={ath ? `${formatPrice(ath.priceWei)} BNB` : "N/A"} accent="text-gold" />
          <StatCard icon={<Crown className="h-3.5 w-3.5" />} label="ATH date" value={formatAthDate(ath?.timestamp)} />
          <StatCard
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Distance from ATH"
            value={fromAth == null ? "N/A" : `${fromAth >= 0 ? "+" : ""}${fromAth.toFixed(2)}%`}
            accent={fromAth != null && fromAth < 0 ? "text-destructive" : "text-success"}
          />
          <StatCard
            icon={<Flame className="h-3.5 w-3.5" />}
            label="ATH market cap"
            value={ath && ath.marketCapWei > 0n ? `${(Number(ath.marketCapWei) / 1e18).toFixed(4)} BNB` : "N/A"}
          />
        </div>


        {/* Analytics strip */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="24h Volume" value={`${analytics.volume24h.toFixed(3)} BNB`} />
          <StatCard icon={<Users className="h-3.5 w-3.5" />} label="Holders" value={analytics.holders} />
          <StatCard icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Buys / Sells" value={`${analytics.buys}/${analytics.sells}`} />
          <StatCard icon={<Flame className="h-3.5 w-3.5" />} label="24h Change" value={`${analytics.priceChange >= 0 ? "+" : ""}${analytics.priceChange.toFixed(2)}%`} accent={analytics.priceChange >= 0 ? "text-success" : "text-destructive"} />
          <StatCard icon={<Droplets className="h-3.5 w-3.5" />} label="Liquidity" value={liquidityBnb != null ? `${liquidityBnb.toFixed(3)} BNB` : "—"} />
        </div>

        {/* Buy / sell pressure — DEXTools style */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <FlowBar label="Volumen" unit="BNB" buy={analytics.buyVol} sell={analytics.sellVol} digits={4} />
          <FlowBar label="Operaciones" unit="tx" buy={analytics.buys} sell={analytics.sells} digits={0} />
          <FlowBar label="Traders" unit="wallets" buy={analytics.buyers} sell={analytics.sellers} digits={0} />
        </div>



        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Price chart · candles</div>
                <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.id}
                      onClick={() => setTimeframe(tf.id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-mono transition ${
                        timeframe === tf.id ? "brand-gradient text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                  <button
                    onClick={() => zoom(-1)}
                    disabled={visibleCount >= 600}
                    aria-label="Alejar (más velas)"
                    className="rounded-full px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="px-1 text-[11px] font-mono tabular-nums text-muted-foreground">
                    {Math.min(visibleCount, allCandles.length || visibleCount)} velas
                  </span>
                  <button
                    onClick={() => zoom(1)}
                    disabled={visibleCount <= 15}
                    aria-label="Acercar (menos velas)"
                    className="rounded-full px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
              {eventsError ? (
                <ChainError error={eventsError} onRetry={() => eventsQ.refetch()} />
              ) : allCandles.length > 0 ? (
                <CandleChart
                  candles={allCandles}
                  visibleCount={visibleCount}
                  onVisibleCountChange={setVisibleCount}
                  athPrice={ath ? Number(ath.priceWei) / 1e18 : null}
                />

              ) : (
                <div className="h-64 rounded-xl border border-dashed border-white/10 grid place-items-center text-sm text-muted-foreground">
                  {eventsQ.isLoading || eventsQ.isFetchingNextPage
                    ? "Leyendo eventos Trade on-chain…"
                    : "Sin eventos Trade en el rango consultado."}
                </div>
              )}

            </div>

            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-accent" />
                  <h3 className="font-display text-lg font-semibold">Recent trades</h3>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">{events.length} eventos</span>
              </div>
              {eventsError ? (
                <ChainError error={eventsError} onRetry={() => eventsQ.refetch()} />
              ) : events.length > 0 ? (
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
                      {[...events].reverse().map((tr) => (
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
                  <div ref={sentinel} className="h-8" />
                  <div className="pt-2 text-center">
                    {eventsQ.isFetchingNextPage ? (
                      <span className="text-xs text-muted-foreground">Cargando más bloques…</span>
                    ) : eventsQ.hasNextPage ? (
                      <Button variant="outline" size="sm" className="border-white/10 bg-white/5" onClick={() => eventsQ.fetchNextPage()}>
                        Cargar histórico anterior
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Fin del histórico disponible.</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
                  {eventsQ.isLoading ? "Leyendo eventos Trade on-chain…" : t("empty.noTrades")}
                </div>
              )}
            </div>

            <TokenInformation
              tokenId={dbRow?.id ? String(dbRow.id) : null}
              fallback={{
                address: (tk.contract_address as string | null) ?? (isAddress(address) ? address : null),
                name: String(tk.name),
                ticker: String(tk.ticker),
              }}
              isCreator={isCreator}
              values={{
                description: (tk.description as string | null) ?? "",
                logo_url: (tk.logo_url as string | null) ?? "",
                banner_url: (tk.banner_url as string | null) ?? "",
                ...socialValues,
              }}
              onSaved={() => tokenQ.refetch()}
            />


            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h3 className="font-display text-lg font-semibold">Comments</h3>
              </div>
              <CommentBox
                tokenId={commentTokenId}
                fallback={{
                  address: (tk.contract_address as string | null) ?? (isAddress(address) ? address : null),
                  name: String(tk.name),
                  ticker: String(tk.ticker),
                }}
                onSent={(id) => {
                  setResolvedTokenId(id);
                  commentsQ.refetch();
                }}
              />



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

            <TopHolders
              token={(tk.contract_address as string | null) ?? (isAddress(address) ? address : null)}
              ticker={String(tk.ticker)}
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

/** Two-sided pressure bar (buy vs sell) built from real Trade events. */
function FlowBar({
  label,
  unit,
  buy,
  sell,
  digits,
}: {
  label: string;
  unit: string;
  buy: number;
  sell: number;
  digits: number;
}) {
  const total = buy + sell;
  const pct = total > 0 ? (buy / total) * 100 : 50;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="normal-case tracking-normal">{unit}</span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between font-mono text-xs tabular-nums">
        <span className="text-success">{fmt(buy)}</span>
        <span className="text-destructive">{fmt(sell)}</span>
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full bg-success/80" style={{ width: `${pct}%` }} />
        <div className="h-full bg-destructive/80" style={{ width: `${100 - pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Buy {pct.toFixed(0)}%</span>
        <span>Sell {(100 - pct).toFixed(0)}%</span>
      </div>
    </div>
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

function ChainError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs">
      <div className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" /> No se pudieron leer los eventos Trade
      </div>
      <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" className="mt-3 border-white/10 bg-white/5" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

/**
 * Comments accept an existing Supabase session OR a connected wallet:
 * in the second case we complete SIWE silently before inserting.
 * If the token only exists on-chain we register its row first, so a wallet
 * user can always comment.
 */
function CommentBox({
  tokenId,
  fallback,
  onSent,
}: {
  tokenId: string | null;
  fallback: { address: string | null; name: string; ticker: string };
  onSent: (tokenId: string) => void;
}) {
  const { user } = useAuth();
  const { address, isConnected } = useAccount();
  const signIn = useSiweSignIn();
  const ensureRow = useServerFn(ensureTokenRow);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const canPost = (!!user || isConnected) && (!!tokenId || !!fallback.address);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const me = user ?? (await signIn());
      let id = tokenId;
      if (!id) {
        if (!fallback.address) throw new Error("Este token no tiene dirección on-chain válida.");
        const r = await ensureRow({
          data: { address: fallback.address, name: fallback.name, ticker: fallback.ticker },
        });
        id = r.id;
      }
      const { error } = await supabase
        .from("comments")
        .insert({ token_id: id, content: body.trim(), user_id: me.id });
      if (error) throw error;
      setBody("");
      onSent(id);

    } catch (e) {
      console.error("[comments] insert failed", e);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={canPost ? "Say something…" : "Conecta tu wallet para comentar"}
          disabled={!canPost}
        />
        <Button onClick={send} disabled={busy || !canPost} className="brand-gradient text-primary-foreground">
          {busy ? "…" : "Post"}
        </Button>
      </div>
      {!user && isConnected && (
        <p className="mt-2 text-[11px] text-muted-foreground font-mono">
          Se firmará el mensaje SIWE con {address?.slice(0, 6)}…{address?.slice(-4)} al publicar.
        </p>
      )}
    </div>
  );
}


/* ----------------------------- Top 10 holders ----------------------------- */

function TopHolders({ token, ticker }: { token: string | null; ticker: string }) {
  const valid = token && isAddress(token) ? (token as `0x${string}`) : null;
  const q = useQuery({
    queryKey: ["holders", valid],
    enabled: !!valid,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: () => fetchTopHolders(valid!, 10),
  });

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          <h3 className="font-display text-base font-semibold">Top 10 holders</h3>
        </div>
        {q.data && (
          <span className="text-[10px] font-mono text-muted-foreground">{q.data.count} wallets</span>
        )}
      </div>

      {!valid ? (
        <p className="text-xs text-muted-foreground">Dirección de token no disponible.</p>
      ) : q.isLoading ? (
        <p className="text-xs text-muted-foreground">Leyendo transferencias on-chain…</p>
      ) : q.error ? (
        <p className="text-xs text-destructive break-words font-mono">{(q.error as Error).message}</p>
      ) : !q.data?.holders.length ? (
        <p className="text-xs text-muted-foreground">Sin transferencias en el rango consultado.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.holders.map((h, i) => (
            <li key={h.address} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-muted-foreground font-mono">{i + 1}</span>
              <a
                href={`${BSC_TESTNET.explorer}/address/${h.address}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground"
              >
                {h.address.slice(0, 6)}…{h.address.slice(-4)}
              </a>
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full brand-gradient" style={{ width: `${Math.max(h.share, 1)}%` }} />
              </div>
              <span className="font-mono tabular-nums w-12 text-right">{h.share.toFixed(2)}%</span>
            </li>
          ))}
        </ul>
      )}
      {q.data && !q.data.complete && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          Ventana parcial de bloques: el reparto refleja las transferencias recientes de ${ticker}.
        </p>
      )}
    </div>
  );
}

/* --------------------------- Token information ---------------------------- */

type MetaFields = {
  description: string;
  logo_url: string;
  banner_url: string;
} & Record<SocialKey, string>;

function TokenInformation({
  tokenId,
  fallback,
  isCreator,
  values,
  onSaved,
}: {
  tokenId: string | null;
  fallback: { address: string | null; name: string; ticker: string };
  isCreator: boolean;
  values: MetaFields;
  onSaved: () => void;
}) {
  const save = useServerFn(updateTokenMeta);
  const ensureRow = useServerFn(ensureTokenRow);
  const uploadMedia = useServerFn(uploadTokenMedia);
  const ensureSession = useSiweSignIn();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MetaFields>(values);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);
  const set = (k: keyof MetaFields, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function upload(kind: "logo" | "banner", file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    try {
      await ensureSession();
      const url = await uploadTokenImage(uploadMedia, kind, file);
      set(kind === "logo" ? "logo_url" : "banner_url", url);
      toast.success("Imagen subida");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await ensureSession();
      let id = tokenId;
      if (!id) {
        if (!fallback.address) throw new Error("No se pudo identificar el token.");
        const r = await ensureRow({
          data: { address: fallback.address, name: fallback.name, ticker: fallback.ticker },
        });
        id = r.id;
      }
      await save({ data: { tokenId: id, ...form } });
      toast.success("Información actualizada");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string]> = SOCIAL_FIELDS.map((f) => [f.label, values[f.key]]);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-lg font-semibold">Token information</h3>
        {isCreator && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5"
            onClick={() => {
              setForm(values);
              setEditing((e) => !e);
            }}
          >
            {editing ? "Cancelar" : "Editar detalles"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Textarea
            rows={3}
            placeholder="Descripción del proyecto"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Input placeholder="Logo URL" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
              <Input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" disabled={uploading !== null} onChange={(e) => upload("logo", e.target.files?.[0])} />
            </div>
            <div className="space-y-2">
              <Input placeholder="Banner URL" value={form.banner_url} onChange={(e) => set("banner_url", e.target.value)} />
              <Input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" disabled={uploading !== null} onChange={(e) => upload("banner", e.target.files?.[0])} />
            </div>
            {SOCIAL_FIELDS.map((f) => (
              <Input
                key={f.key}
                placeholder={f.placeholder}
                value={form[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ))}
          </div>
          <Button onClick={submit} disabled={busy || uploading !== null} className="brand-gradient text-primary-foreground">
            {uploading ? "Subiendo imagen…" : busy ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {values.description || "El creador todavía no añadió una descripción."}
          </p>
          <dl className="grid gap-2 sm:grid-cols-2 text-xs">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate max-w-[60%] text-right">
                  {value ? (
                    <a href={value} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {value.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
