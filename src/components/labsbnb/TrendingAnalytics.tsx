import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { getTokenTrending } from "@/lib/trending.functions";
import { ScoreChip, TrendingBadges, VelocityLabel } from "./TrendingBadges";

const na = (v: number | null | undefined, fn: (n: number) => string) => (v == null ? "N/A" : fn(v));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

/** 🎯 Trending Analytics for one token — real on-chain data only. */
export function TrendingAnalytics({ address }: { address: string }) {
  const q = useQuery({
    queryKey: ["trending", "token", address.toLowerCase()],
    queryFn: () => getTokenTrending({ data: { address } }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const row = q.data?.row ?? null;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" />
          <h3 className="font-display text-base font-semibold">🎯 Trending Analytics</h3>
        </div>
        {row && <ScoreChip score={row.trendingScore} />}
      </div>

      {q.isLoading && !q.data ? (
        <div className="h-40 animate-pulse rounded-xl bg-white/5" />
      ) : !row ? (
        <p className="text-sm text-muted-foreground">
          Este token todavía no aparece en el ranking: no hay actividad on-chain suficiente en las ventanas
          analizadas.
        </p>
      ) : (
        <>
          <TrendingBadges badges={row.badges} className="mb-3" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Trending Score" value={`${row.trendingScore}/100`} />
            <Stat label="Rank" value={`#${row.rank} de ${q.data?.totalRanked ?? 0}`} />
            <Stat label="Organic Activity" value={`${row.organicScore}/100`} />
            <Stat label="Volume 15m" value={`${row.volumes["15m"].toFixed(4)} BNB`} />
            <Stat label="Volume 1h" value={`${row.volumes["1h"].toFixed(4)} BNB`} />
            <Stat label="Volume 24h" value={`${row.volumes["24h"].toFixed(4)} BNB`} />
            <Stat label="Buyers 1h" value={String(row.buyers)} />
            <Stat label="Sellers 1h" value={String(row.sellers)} />
            <Stat label="Whale trades 1h" value={String(row.whaleTrades)} />
            <Stat label="Holders" value={na(row.holders, (n) => String(n))} />
            <Stat label="Bonding progress" value={na(row.bondingProgress, (n) => `${n.toFixed(2)}%`)} />
            <Stat
              label="To graduate"
              value={row.bondingRemaining == null ? "N/A" : `${Number(row.bondingRemaining).toFixed(3)} BNB`}
            />
          </div>

          <div className="mt-3">
            <VelocityLabel value={row.velocityScore} />
          </div>

          <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3">
            <div className="text-[11px] font-medium text-foreground">Why is this token trending?</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.reason}</p>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              Resumen descriptivo de la actividad on-chain registrada. No es asesoramiento financiero ni una
              predicción de precio.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
