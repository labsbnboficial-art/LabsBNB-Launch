// Ranking selection: tabs, stage filters, timeframe and pagination.
// Pure so the API route, the server function and the tests share one behaviour.
import type { TrendingCategory, TrendingRow, TrendingStage, WindowId } from "./trending-types";

export type QueryInput = {
  timeframe: WindowId;
  category: TrendingCategory;
  stage: TrendingStage;
  minTrades: number;
  limit: number;
  cursor: number;
};

function byStage(rows: TrendingRow[], stage: TrendingStage, nearPct = 80): TrendingRow[] {
  if (stage === "all") return rows;
  if (stage === "graduated") return rows.filter((r) => r.graduated);
  if (stage === "bonding") return rows.filter((r) => !r.graduated);
  return rows.filter((r) => !r.graduated && (r.bondingProgress ?? 0) >= nearPct);
}

function sortFor(category: TrendingCategory, timeframe: WindowId) {
  const vol = (r: TrendingRow) => r.volumes[timeframe] ?? 0;
  switch (category) {
    case "rising":
      return (a: TrendingRow, b: TrendingRow) =>
        (b.velocityScore ?? -Infinity) - (a.velocityScore ?? -Infinity) || b.trendingScore - a.trendingScore;
    case "volume":
      return (a: TrendingRow, b: TrendingRow) => vol(b) - vol(a) || b.trendingScore - a.trendingScore;
    case "graduation":
      return (a: TrendingRow, b: TrendingRow) =>
        (b.bondingProgress ?? -1) - (a.bondingProgress ?? -1) || b.trendingScore - a.trendingScore;
    default:
      return (a: TrendingRow, b: TrendingRow) =>
        b.trendingScore - a.trendingScore || vol(b) - vol(a) || a.address.localeCompare(b.address);
  }
}

export function applyTrendingQuery(rows: TrendingRow[], q: QueryInput) {
  let list = byStage(rows, q.stage);
  if (q.category === "graduation") list = list.filter((r) => !r.graduated && (r.bondingProgress ?? 0) > 0);
  if (q.category === "rising") list = list.filter((r) => r.velocityScore != null);
  if (q.minTrades > 0) list = list.filter((r) => r.trades >= q.minTrades);

  const sorted = [...list]
    .sort(sortFor(q.category, q.timeframe))
    .map((r, i) => ({ ...r, rank: i + 1, volume: r.volumes[q.timeframe] ?? 0 }));

  const page = sorted.slice(q.cursor, q.cursor + q.limit);
  const next = q.cursor + q.limit < sorted.length ? q.cursor + q.limit : null;
  const updatedAt = sorted[0]?.updatedAt ?? null;

  return {
    tokens: page,
    total: sorted.length,
    nextCursor: next,
    timeframe: q.timeframe,
    category: q.category,
    updatedAt,
  };
}
