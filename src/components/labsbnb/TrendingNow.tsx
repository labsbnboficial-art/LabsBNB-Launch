import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { getTrending } from "@/lib/trending.functions";
import type { TrendingRow } from "@/lib/trending/trending-types";
import { ScoreChip, TrendingBadges, VelocityLabel } from "./TrendingBadges";
import { fmtUsd } from "./TokenCard";

const na = (v: number | null | undefined, fn: (n: number) => string) => (v == null ? "N/A" : fn(v));

export function TrendingCard({ row, bnbUsd }: { row: TrendingRow; bnbUsd: number }) {
  const change = row.priceChange24h;
  return (
    <Link
      to="/token/$address"
      params={{ address: row.address }}
      className="glass card-glow flex flex-col gap-3 rounded-2xl p-4 transition hover:border-accent/40"
    >
      <div className="flex items-center gap-3">
        <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">#{row.rank}</span>
        {row.logo ? (
          <img src={row.logo} alt={`${row.name} logo`} loading="lazy" className="h-10 w-10 rounded-xl object-cover" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 font-display text-sm">
            {row.symbol.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">${row.symbol}</div>
        </div>
        <ScoreChip score={row.trendingScore} />
      </div>

      <TrendingBadges badges={row.badges} limit={3} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <Field label="Price" value={row.price == null ? "N/A" : `${Number(row.price).toPrecision(4)} BNB`} />
        <Field
          label="24h"
          value={na(change, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`)}
          tone={change == null ? undefined : change >= 0 ? "text-success" : "text-destructive"}
        />
        <Field
          label="Volume 1h"
          value={bnbUsd ? fmtUsd(row.volumes["1h"] * bnbUsd) : `${row.volumes["1h"].toFixed(4)} BNB`}
        />
        <Field label="Holders" value={na(row.holders, (n) => String(n))} />
        <Field label="Bonding" value={na(row.bondingProgress, (n) => `${n.toFixed(1)}%`)} />
        <Field
          label="To graduate"
          value={row.bondingRemaining == null ? "N/A" : `${Number(row.bondingRemaining).toFixed(3)} BNB`}
        />
      </div>

      {row.bondingProgress != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full brand-gradient" style={{ width: `${Math.min(100, row.bondingProgress)}%` }} />
        </div>
      )}

      <VelocityLabel value={row.velocityScore} />
    </Link>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

/** 🔥 Trending Now — top 5 tokens by server-computed Trending Score. */
export function TrendingNow({ bnbUsd }: { bnbUsd: number }) {
  const q = useQuery({
    queryKey: ["trending", "home"],
    queryFn: () => getTrending({ data: { timeframe: "1h", category: "trending", limit: 5 } }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const rows = q.data?.tokens ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-accent" />
          <h3 className="font-display text-lg font-semibold">🔥 Trending Now</h3>
        </div>
        <Link to="/trending" className="text-xs text-muted-foreground hover:text-foreground">
          Ver todo →
        </Link>
      </div>

      {q.isLoading && !q.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass h-56 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-muted-foreground">
          Trending no disponible ahora mismo. Reintentando automáticamente…
        </div>
      ) : rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {rows.map((row) => (
            <TrendingCard key={row.address} row={row} bnbUsd={bnbUsd} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay actividad on-chain suficiente para calcular el Trending.
        </div>
      )}
    </div>
  );
}
