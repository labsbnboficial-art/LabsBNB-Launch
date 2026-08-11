// 👑 KING OF THE HILL
//
// The reigning token is picked automatically from the live on-chain metrics of
// the launchpad: the most advanced bonding curve that has not graduated yet,
// tie-broken by 24h volume and market cap. Nothing is hardcoded — if no token
// qualifies the section renders an empty state.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Crown, LineChart as LineChartIcon, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/web3/live-price";
import { fetchTradeEvents, buildCandles } from "@/lib/web3/curve-events";
import { computeAth, distanceFromAth, formatAthDate } from "@/lib/web3/ath";
import { Sparkline } from "./Sparkline";
import { TokenAvatar, fmtUsd, wei, type TokenView } from "./TokenCard";

/** Eligibility: an active curve with real progress. */
export function pickKing(tokens: TokenView[]): TokenView | null {
  const eligible = tokens.filter((t) => t.metrics && t.metrics.progressBps > 0 && t.metrics.progressBps < 10_000);
  const pool = eligible.length
    ? eligible
    : tokens.filter((t) => t.metrics && wei(t.metrics.marketCapWei) > 0);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const pa = a.metrics!.progressBps;
    const pb = b.metrics!.progressBps;
    if (pb !== pa) return pb - pa;
    const va = wei(a.metrics!.volume24hWei);
    const vb = wei(b.metrics!.volume24hWei);
    if (vb !== va) return vb - va;
    return wei(b.metrics!.marketCapWei) - wei(a.metrics!.marketCapWei);
  })[0];
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`truncate font-mono text-sm tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function KingOfTheHill({ tokens, bnbUsd, loading }: { tokens: TokenView[]; bnbUsd: number; loading: boolean }) {
  const king = useMemo(() => pickKing(tokens), [tokens]);

  // Real trade history of the reigning token only (one curve => one log scan).
  const historyQ = useQuery({
    queryKey: ["king-history", king?.curve ?? null],
    enabled: !!king?.curve,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: () => fetchTradeEvents(king!.curve as `0x${string}`),
  });

  const events = historyQ.data ?? [];
  const spark = useMemo(() => buildCandles(events, 900).map((c) => c.close), [events]);
  const ath = useMemo(() => computeAth(events), [events]);

  if (loading) {
    return <div className="king-surface h-64 animate-pulse rounded-3xl" />;
  }

  if (!king) {
    return (
      <div className="king-surface rounded-3xl p-10 text-center">
        <Crown className="mx-auto h-7 w-7 text-gold opacity-70" />
        <div className="mt-3 font-display text-xl font-semibold">No King of the Hill yet</div>
        <p className="mt-1 text-sm text-muted-foreground">
          El primer token con una curva activa reclamará la corona automáticamente.
        </p>
      </div>
    );
  }

  const m = king.metrics!;
  const progress = Math.min(100, m.progressBps / 100);
  const change = m.priceChangeBps / 100;
  const mcapBnb = wei(m.marketCapWei);
  const fromAth = distanceFromAth(BigInt(m.priceWei), ath?.priceWei ?? null);
  const target = wei(m.targetBnbWei);
  const raised = wei(m.liquidityWei);
  const remaining = target > raised ? target - raised : 0;

  return (
    <div key={king.id} className="king-surface relative overflow-hidden rounded-3xl animate-fade-in">
      {/* Depth + sheen (GPU transform only, disabled under prefers-reduced-motion) */}
      <div
        aria-hidden
        className="animate-king-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/8 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--gold), transparent 70%)" }}
      />

      <div className="relative grid gap-6 p-6 md:grid-cols-[auto_minmax(0,1fr)] md:p-8">
        <div className="relative mx-auto md:mx-0">
          <Crown className="animate-crown absolute -top-6 left-1/2 h-8 w-8 -translate-x-1/2 text-gold drop-shadow-[0_0_10px_oklch(0.83_0.14_85_/_0.6)]" />
          <TokenAvatar
            token={king}
            className="h-28 w-28 md:h-36 md:w-36 gold-glow"
            rounded="rounded-3xl"
          />
        </div>

        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.83_0.14_85_/_0.4)] bg-[oklch(0.83_0.14_85_/_0.1)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
            <Crown className="h-3 w-3" /> King of the Hill
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl font-bold md:text-3xl">{king.name}</h2>
              <div className="font-mono text-sm text-accent">${king.ticker}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xl font-semibold tabular-nums md:text-2xl">
                {formatPrice(m.priceWei)} <span className="text-xs text-muted-foreground">BNB</span>
              </div>
              <div className={`font-mono text-xs ${change >= 0 ? "text-success" : "text-destructive"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}% 24h
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Market cap" value={bnbUsd ? fmtUsd(mcapBnb * bnbUsd) : `${mcapBnb.toFixed(3)} BNB`} />
            <Stat label="24h Volume" value={`${wei(m.volume24hWei).toFixed(3)} BNB`} />
            <Stat label="Holders" value={String(m.holders)} />
            <Stat label="ATH" value={ath ? `${formatPrice(ath.priceWei)}` : "N/A"} tone="text-gold" />
            <Stat
              label="From ATH"
              value={fromAth == null ? "N/A" : `${fromAth >= 0 ? "+" : ""}${fromAth.toFixed(1)}%`}
              tone={fromAth != null && fromAth < 0 ? "text-destructive" : "text-success"}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>ATH date · <span className="normal-case tracking-normal text-foreground">{formatAthDate(ath?.timestamp)}</span></span>
            <Sparkline values={spark} width={160} height={28} className="w-40" />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>Bonding curve</span>
              <span className="font-mono text-foreground">{progress.toFixed(2)}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${Math.max(progress, 1)}%`, background: "linear-gradient(90deg, var(--electric), var(--gold))" }}
              />
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              {target > 0 ? `${remaining.toFixed(3)} BNB remaining to graduation` : "Objetivo de graduación: N/A"}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/token/$address" params={{ address: king.contract_address ?? king.id }}>
              <Button className="h-10 brand-gradient px-5 font-medium text-primary-foreground hover:opacity-90">
                <LineChartIcon className="mr-2 h-4 w-4" /> Trade
              </Button>
            </Link>
            <Link to="/token/$address" params={{ address: king.contract_address ?? king.id }}>
              <Button variant="outline" className="h-10 border-white/10 bg-white/5 px-5">
                View token <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
