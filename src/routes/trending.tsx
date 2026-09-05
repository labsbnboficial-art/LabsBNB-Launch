import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Flame } from "lucide-react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { TrendingCard } from "@/components/labsbnb/TrendingNow";
import { getTrending } from "@/lib/trending.functions";
import { useBnbPrice } from "@/lib/web3/useLabsBnbPrice";
import {
  TREND_WINDOWS,
  type TrendingCategory,
  type TrendingStage,
  type WindowId,
} from "@/lib/trending/trending-types";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/trending")({
  head: () => ({
    meta: [
      { title: "Trending tokens on LabsBNB Launchpad" },
      {
        name: "description",
        content:
          "Live on-chain trending ranking: momentum, volume velocity, unique buyers and bonding curve progress for every LabsBNB token on BNB Chain.",
      },
      { property: "og:title", content: "Trending tokens on LabsBNB Launchpad" },
      {
        property: "og:description",
        content: "Real-time trending score built from BNB Chain trade activity — no simulated data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TrendingPage,
});

const TABS: { id: TrendingCategory; label: string }[] = [
  { id: "trending", label: "Trending Now" },
  { id: "rising", label: "Rising Fast" },
  { id: "volume", label: "Top Volume" },
  { id: "graduation", label: "Near Graduation" },
];

const STAGES: { id: TrendingStage; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bonding", label: "Bonding Curve" },
  { id: "near_graduation", label: "Near Graduation" },
  { id: "graduated", label: "Graduated" },
];

const MIN_ACTIVITY = [0, 1, 5, 20];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-accent/50 bg-accent/10 text-accent" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function TrendingPage() {
  const [category, setCategory] = useState<TrendingCategory>("trending");
  const [timeframe, setTimeframe] = useState<WindowId>("1h");
  const [stage, setStage] = useState<TrendingStage>("all");
  const [minTrades, setMinTrades] = useState(0);
  const [limit, setLimit] = useState(20);
  const price = useBnbPrice();
  const bnbUsd = price.data?.usd ?? 0;

  const q = useQuery({
    queryKey: ["trending", "page", category, timeframe, stage, minTrades, limit],
    queryFn: () => getTrending({ data: { category, timeframe, stage, minTrades, limit } }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const rows = q.data?.tokens ?? [];

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl px-4 pt-10 md:px-6">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-accent" />
          <h1 className="font-display text-2xl font-bold md:text-3xl">🔥 Trending</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Ranking calculado en el servidor a partir de la actividad real de BNB Chain: volumen reciente,
          aceleración, compradores únicos, holders y progreso de la bonding curve. Cuando un dato no está
          disponible on-chain se muestra <span className="font-mono">N/A</span>.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <Chip key={tab.id} active={category === tab.id} onClick={() => setCategory(tab.id)}>
              {tab.label}
            </Chip>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="glass rounded-xl p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Time</div>
            <div className="flex flex-wrap gap-1.5">
              {TREND_WINDOWS.map((w) => (
                <Chip key={w} active={timeframe === w} onClick={() => setTimeframe(w)}>
                  {w.toUpperCase()}
                </Chip>
              ))}
            </div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Stage</div>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => (
                <Chip key={s.id} active={stage === s.id} onClick={() => setStage(s.id)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Minimum activity (24h trades)</div>
            <div className="flex flex-wrap gap-1.5">
              {MIN_ACTIVITY.map((n) => (
                <Chip key={n} active={minTrades === n} onClick={() => setMinTrades(n)}>
                  {n === 0 ? "Any" : `${n}+`}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-8 max-w-7xl px-4 pb-16 md:px-6">
        {q.isLoading && !q.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass h-56 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
            No se pudo cargar el ranking. Reintentando automáticamente…
          </div>
        ) : rows.length ? (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {q.data?.total ?? 0} token{(q.data?.total ?? 0) === 1 ? "" : "s"} · fuente: {q.data?.source}
              </span>
              {q.data?.updatedAt && <span>Actualizado {new Date(q.data.updatedAt).toLocaleTimeString()}</span>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rows.map((row) => (
                <TrendingCard key={row.address} row={row} bnbUsd={bnbUsd} />
              ))}
            </div>
            {q.data?.nextCursor != null && (
              <div className="mt-6 text-center">
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/5"
                  onClick={() => setLimit((l) => l + 20)}
                >
                  Cargar más
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
            Ningún token cumple estos filtros con datos on-chain reales.
          </div>
        )}
      </section>
    </AppShell>
  );
}
