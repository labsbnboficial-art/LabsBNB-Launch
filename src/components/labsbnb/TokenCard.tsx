// Shared token view-model + premium token card used across the launchpad.
// Every value comes from the on-chain curve metrics (or the database metadata);
// missing values render as "N/A" — never invented numbers.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { formatPrice } from "@/lib/web3/live-price";
import type { CurveMetrics } from "@/lib/web3/onchain-token";
import { Sparkline } from "./Sparkline";

export type TokenView = {
  id: string;
  name: string;
  ticker: string;
  logo_url: string | null;
  contract_address: string | null;
  curve?: `0x${string}` | null;
  status: string;
  created_at: string;
  category: string | null;
  metrics: CurveMetrics | null;
};

export const wei = (v?: string | null) => (v ? Number(v) / 1e18 : 0);

export function fmtUsd(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** "Just now" / "2m ago" / "3h ago" / "4d ago" — real elapsed time. */
export function timeAgo(iso?: string | null) {
  if (!iso) return "N/A";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "N/A";
  const s = Math.floor(ms / 1000);
  if (s < 45) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Image with skeleton + graceful fallback, fixed ratio (no layout shift). */
export function TokenAvatar({
  token,
  className = "h-11 w-11",
  rounded = "rounded-xl",
}: {
  token: Pick<TokenView, "logo_url" | "name" | "ticker">;
  className?: string;
  rounded?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!token.logo_url || failed) {
    return (
      <div
        className={`${className} ${rounded} brand-gradient grid shrink-0 place-items-center font-display font-bold text-primary-foreground`}
      >
        {token.ticker?.[0] ?? "?"}
      </div>
    );
  }
  return (
    <div className={`${className} ${rounded} relative shrink-0 overflow-hidden bg-white/5`}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/10" />}
      <img
        src={token.logo_url}
        alt={`${token.name} logo`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`truncate font-mono text-xs tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function TokenCard({
  token,
  bnbUsd,
  spark = [],
  athPriceWei,
}: {
  token: TokenView;
  bnbUsd: number;
  /** Real closes for the mini trend line. Empty = neutral state. */
  spark?: number[];
  athPriceWei?: bigint | null;
}) {
  const m = token.metrics;
  const change = m ? m.priceChangeBps / 100 : null;
  const progress = m ? Math.min(100, m.progressBps / 100) : null;
  const mcapBnb = m ? wei(m.marketCapWei) : null;
  const priceBnb = m ? Number(m.priceWei) / 1e18 : null;
  const athBnb = athPriceWei ? Number(athPriceWei) / 1e18 : null;
  const fromAth = athBnb && priceBnb ? ((priceBnb - athBnb) / athBnb) * 100 : null;

  return (
    <Link
      to="/token/$address"
      params={{ address: token.contract_address ?? token.id }}
      className="glass card-glow group flex flex-col rounded-2xl p-4"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <TokenAvatar token={token} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{token.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">${token.ticker}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${m ? "bg-success" : "bg-muted-foreground/50"}`} />
          {m ? "live" : token.status}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-lg font-semibold tabular-nums">
            {m ? formatPrice(m.priceWei) : "N/A"}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">BNB / token</div>
        </div>
        <div className="text-right">
          <div
            className={`font-mono text-sm tabular-nums ${
              change == null ? "text-muted-foreground" : change >= 0 ? "text-success" : "text-destructive"
            }`}
          >
            {change == null ? "N/A" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
          </div>
          <Sparkline values={spark} width={96} height={26} className="w-24" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/5 pt-3 sm:grid-cols-4">
        <Metric label="MC" value={mcapBnb != null ? (bnbUsd ? fmtUsd(mcapBnb * bnbUsd) : `${mcapBnb.toFixed(3)} BNB`) : "N/A"} />
        <Metric label="24h Vol" value={m ? `${wei(m.volume24hWei).toFixed(3)} BNB` : "N/A"} />
        <Metric label="Holders" value={m ? String(m.holders) : "N/A"} />
        <Metric
          label="ATH"
          value={athBnb != null ? formatPrice(athPriceWei!) : "N/A"}
          tone={athBnb != null ? "text-gold" : undefined}
        />
      </div>

      {fromAth != null && (
        <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
          {fromAth >= 0 ? "+" : ""}
          {fromAth.toFixed(1)}% from ATH
        </div>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Bonding curve</span>
          <span className="font-mono text-foreground">{progress != null ? `${progress.toFixed(2)}%` : "N/A"}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full brand-gradient transition-[width] duration-500"
            style={{ width: `${Math.max(progress ?? 0, 1)}%` }}
          />
        </div>
      </div>
    </Link>
  );
}
