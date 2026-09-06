// Shared presentation for the 🏆 Creator Leaderboard and 🗓️ Season standings.
// Every number comes from the server engine; a missing metric renders "N/A".
import { Link } from "@tanstack/react-router";
import { CATEGORY_LABEL, METRIC_LABEL, type LeaderboardEntry, type LeaderboardMetric } from "@/lib/leaderboard/leaderboard-types";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const naNum = (v: number | null | undefined, fn: (n: number) => string) => (v == null ? "N/A" : fn(v));

export function RankChange({ entry }: { entry: LeaderboardEntry }) {
  if (entry.isNew) {
    return <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold text-accent">NEW</span>;
  }
  if (entry.rankChange == null || entry.rankChange === 0) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const up = entry.rankChange > 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? "text-success" : "text-destructive"}`}>
      {up ? "▲" : "▼"} {Math.abs(entry.rankChange)}
    </span>
  );
}

function Avatar({ entry, size = 36 }: { entry: LeaderboardEntry; size?: number }) {
  const label = entry.displayName ?? shortAddress(entry.address);
  return entry.avatarUrl ? (
    <img
      src={entry.avatarUrl}
      alt={`Avatar de ${label}`}
      loading="lazy"
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="grid place-items-center rounded-full bg-white/5 text-xs"
      style={{ width: size, height: size }}
      aria-hidden
    >
      👤
    </div>
  );
}

const MEDAL = ["🥇", "🥈", "🥉"];

export function LeaderboardPodium({ top3 }: { top3: LeaderboardEntry[] }) {
  if (!top3.length) return null;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {top3.map((e, i) => (
        <Link
          key={e.address}
          to="/creator/$address"
          params={{ address: e.address }}
          className="glass rounded-2xl p-4 transition hover:border-accent/40"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{MEDAL[i]}</span>
            <Avatar entry={e} size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{e.displayName ?? shortAddress(e.address)}</div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span>#{e.rank}</span>
                <RankChange entry={e} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Overall</span>
            <span className="font-mono text-base tabular-nums">{e.overallScore.toFixed(1)}</span>
          </div>
          {e.level && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {e.level.icon} {e.level.name}
            </div>
          )}
          {e.achievementBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {e.achievementBadges.slice(0, 5).map((b) => (
                <span key={b.key} title={b.name} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[11px]">
                  {b.icon}
                </span>
              ))}
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}

export function MetricNotice({ metrics }: { metrics: LeaderboardMetric[] }) {
  if (!metrics.length) return null;
  return (
    <p className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-muted-foreground">
      Datos no disponibles ahora mismo: {metrics.map((m) => METRIC_LABEL[m]).join(", ")}. Su peso se redistribuye
      entre las métricas medibles; nunca se inventan valores.
    </p>
  );
}

export function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <Link
      to="/creator/$address"
      params={{ address: entry.address }}
      className="glass flex flex-col gap-2 rounded-xl p-3 transition hover:border-accent/40 md:flex-row md:items-center"
    >
      <div className="flex w-16 shrink-0 items-center gap-2">
        <span className="font-mono text-sm tabular-nums">#{entry.rank}</span>
        <RankChange entry={entry} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar entry={entry} />
        <div className="min-w-0">
          <div className="truncate text-sm">{entry.displayName ?? shortAddress(entry.address)}</div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{shortAddress(entry.address)}</span>
            {entry.level && (
              <span>
                {entry.level.icon} {entry.level.name}
              </span>
            )}
            {entry.achievementBadges.slice(0, 4).map((b) => (
              <span key={b.key} title={b.name}>
                {b.icon}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2 text-[11px] md:grid-cols-6">
        <Cell label="Overall" value={entry.overallScore.toFixed(1)} />
        <Cell label="Points" value={naNum(entry.raw.points, (n) => n.toLocaleString())} />
        <Cell label="Score" value={naNum(entry.raw.score, (n) => `${n}/100`)} />
        <Cell label="Graduations" value={naNum(entry.raw.graduations, String)} />
        <Cell label="Tokens" value={String(entry.extras.tokensCreated)} />
        <Cell label="Best rank" value={naNum(entry.bestRank, (n) => `#${n}`)} />
      </div>
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}

export function LeaderboardList({
  entries,
  emptyLabel = "Todavía no hay creadores con actividad medible en BNB Chain.",
}: {
  entries: LeaderboardEntry[];
  emptyLabel?: string;
}) {
  if (!entries.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <LeaderboardRow key={e.address} entry={e} />
      ))}
    </div>
  );
}

export { CATEGORY_LABEL };
