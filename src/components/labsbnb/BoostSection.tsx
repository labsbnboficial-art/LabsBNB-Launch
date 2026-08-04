import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getBoostState } from "@/lib/boost.functions";
import { supabase } from "@/integrations/supabase/client";
import { fetchOnChainToken, isAddress } from "@/lib/web3/onchain-token";
import { formatEther } from "viem";
import { Rocket, ChevronLeft, ChevronRight, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAGE = 5;

function fmtBnb(wei?: string | null) {
  if (!wei) return "—";
  try { return `${Number(formatEther(BigInt(wei))).toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB`; }
  catch { return "—"; }
}

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expirado";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function BoostCard({ address, name, ticker, expiresAt }: { address: string; name: string | null; ticker: string | null; expiresAt: string }) {
  const q = useQuery({
    queryKey: ["boost-card", address],
    enabled: isAddress(address),
    refetchInterval: 30_000,
    queryFn: () => fetchOnChainToken(address as `0x${string}`),
  });
  const m = q.data?.metrics ?? null;
  const progress = m ? Math.min(100, m.progressBps / 100) : 0;

  return (
    <Link
      to="/token/$address"
      params={{ address }}
      className="glass-strong group relative overflow-hidden rounded-3xl border border-primary/25 p-5 transition hover:border-primary/60"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold">{q.data?.name || name || "Token"}</p>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">${q.data?.ticker || ticker || "?"}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
          <Rocket className="h-3 w-3" /> Impulso
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-muted-foreground">Market cap</p><p className="font-mono">{fmtBnb(m?.marketCapWei)}</p></div>
        <div><p className="text-muted-foreground">Volumen 24h</p><p className="font-mono">{fmtBnb(m?.volume24hWei)}</p></div>
        <div><p className="text-muted-foreground">Liquidez</p><p className="font-mono">{fmtBnb(m?.liquidityWei)}</p></div>
        <div><p className="text-muted-foreground">Holders</p><p className="font-mono">{m?.holders ?? "—"}</p></div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full brand-gradient" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{progress.toFixed(1)}% curva</span>
          <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> {timeLeft(expiresAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function BoostSection() {
  const fn = useServerFn(getBoostState);
  const q = useQuery({ queryKey: ["boost-state"], queryFn: () => fn(), refetchInterval: 30_000 });
  const [page, setPage] = useState(0);

  useEffect(() => {
    const ch = supabase
      .channel("token-boosts")
      .on("postgres_changes", { event: "*", schema: "public", table: "token_boosts" }, () => { void q.refetch(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boosts = q.data?.boosts ?? [];
  if (!q.data?.settings.enabled || boosts.length === 0) return null;

  const pages = Math.ceil(boosts.length / PAGE);
  const slice = boosts.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">🚀 Impulso</h2>
          <p className="text-sm text-muted-foreground">Proyectos destacados dentro del launchpad.</p>
        </div>
        {pages > 1 && (
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setPage((p) => (p - 1 + pages) % pages)} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => setPage((p) => (p + 1) % pages)} aria-label="Siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {slice.map((b) => (
          <BoostCard key={b.id} address={b.token_address} name={b.token_name} ticker={b.token_ticker} expiresAt={b.expires_at} />
        ))}
      </div>
    </section>
  );
}
