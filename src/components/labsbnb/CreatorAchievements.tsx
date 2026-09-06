// 🏆 Creator Achievements (Fase 2D) — public, read-only showcase.
//
// Everything shown here comes from the server-side immutable ledger. The UI
// never computes an unlock: it only renders unlocked state, progress towards
// locked ones and the verifiable evidence of each unlock.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCreatorAchievements } from "@/lib/achievements.functions";
import { RARITY_TONE, type AchievementRarity, type AchievementView } from "@/lib/achievements/achievement-types";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";

const RARITY_LABEL: Record<AchievementRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] break-all text-right font-mono">{value}</span>
    </div>
  );
}

const EVIDENCE_LABEL: Record<string, string> = {
  tokenAddress: "Token",
  symbol: "Symbol",
  transactionHash: "Transaction",
  blockNumber: "Block",
  metric: "Métrica",
  value: "Valor",
  threshold: "Umbral",
  organicScore: "Organic Score",
  uniqueBuyers: "Compradores únicos",
  trendingScore: "Trending Score",
  bondingProgress: "Bonding Progress",
  createdAt: "Creado",
  timestamp: "Fecha del evento",
  tokens: "Tokens",
  requirements: "Requisitos",
  levelMilestones: "Niveles alcanzados",
};

function AchievementCard({ a, onOpen }: { a: AchievementView; onOpen: (a: AchievementView) => void }) {
  const tone = RARITY_TONE[a.rarity];
  return (
    <button
      type="button"
      onClick={() => a.unlocked && onOpen(a)}
      disabled={!a.unlocked}
      className={`rounded-xl border p-3 text-left transition ${tone} ${
        a.unlocked ? "bg-white/[0.04] hover:border-accent/40" : "border-white/5 bg-white/[0.01] opacity-55"
      }`}
      aria-label={`${a.name} — ${a.unlocked ? "desbloqueado" : "bloqueado"}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={`text-2xl ${a.unlocked ? "" : "grayscale"}`}>
          {a.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{a.name}</span>
            {a.legacy && <span className="text-[9px] uppercase tracking-widest text-muted-foreground">legacy</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{a.description}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest">
        <span>{RARITY_LABEL[a.rarity]}</span>
        <span className="text-muted-foreground">{a.unlocked ? day(a.unlockedAt) : "Locked"}</span>
      </div>
      {!a.unlocked && a.progress && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full brand-gradient"
              style={{ width: `${Math.min(100, Math.round((a.progress.current / Math.max(1, a.progress.target)) * 100))}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            {a.progress.current}/{a.progress.target} {a.progress.label}
          </div>
        </div>
      )}
      {!a.unlocked && !a.progress && (
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">Progreso N/A</div>
      )}
    </button>
  );
}

export function CreatorAchievementsSection({ address }: { address: string }) {
  const creator = address.toLowerCase();
  const [open, setOpen] = useState<AchievementView | null>(null);

  const q = useQuery({
    queryKey: ["creator-achievements", creator],
    queryFn: () => getCreatorAchievements({ data: { address } }),
    staleTime: 120_000,
  });

  if (q.isLoading && !q.data) return <div className="mt-6 glass h-40 animate-pulse rounded-2xl" />;
  if (!q.data) return null;

  const { achievements, unlockedAchievements, totalAchievements, completionPercentage, storageReady, storageError } =
    q.data;
  const unlocked = achievements.filter((a) => a.unlocked);

  return (
    <div className="mt-6 glass rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">🏅 Achievements</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {unlockedAchievements}/{totalAchievements} · {completionPercentage}%
        </span>
      </div>

      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full brand-gradient" style={{ width: `${completionPercentage}%` }} />
      </div>

      {!storageReady && (
        <p className="mb-3 rounded-lg border border-dashed border-white/10 p-2 text-[11px] text-muted-foreground">
          El historial de logros aún no está disponible{storageError ? ` (${storageError})` : ""}.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {achievements.map((a) => (
          <AchievementCard key={a.key} a={a} onOpen={setOpen} />
        ))}
      </div>

      {unlocked.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">Timeline</h3>
          <ol className="space-y-2">
            {[...unlocked]
              .sort((a, b) => Date.parse(a.unlockedAt ?? "") - Date.parse(b.unlockedAt ?? ""))
              .map((a) => (
                <li key={`t-${a.key}`} className="flex gap-3 text-xs">
                  <span className="w-28 shrink-0 font-mono text-muted-foreground">{day(a.unlockedAt)}</span>
                  <span>
                    {a.icon} {a.name}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span aria-hidden="true">{open?.icon}</span> {open?.name}
            </DialogTitle>
          </DialogHeader>
          {open && (
            <div>
              <p className="text-xs text-muted-foreground">{open.description}</p>
              <div className="mt-3">
                <EvidenceRow label="Desbloqueado" value={day(open.unlockedAt)} />
                {Object.entries(open.evidence ?? {}).map(([k, v]) => {
                  if (v == null || v === "") return null;
                  const value = Array.isArray(v) ? v.join(", ") : String(v);
                  return <EvidenceRow key={k} label={EVIDENCE_LABEL[k] ?? k} value={value} />;
                })}
              </div>
              {typeof open.evidence?.["tokenAddress"] === "string" && (
                <a
                  href={`${ACTIVE_NETWORK.explorer}/token/${open.evidence["tokenAddress"]}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-block text-[11px] text-accent hover:underline"
                >
                  Verificar en BscScan ↗
                </a>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Compact badges for directory/list views (no extra request per creator). */
export function AchievementBadgeStrip({
  badges,
  max = 4,
}: {
  badges: { key: string; icon: string; name: string }[];
  max?: number;
}) {
  if (!badges.length) return null;
  const shown = badges.slice(0, max);
  const rest = badges.length - shown.length;
  return (
    <span className="flex items-center gap-1">
      {shown.map((b) => (
        <span key={b.key} title={b.name} aria-label={b.name} className="text-sm">
          {b.icon}
        </span>
      ))}
      {rest > 0 && <span className="font-mono text-[10px] text-muted-foreground">+{rest}</span>}
    </span>
  );
}
