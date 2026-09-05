// GET /api/public/trending — public, read-only ranking (no PII).
// Query: ?timeframe=5m|15m|1h|6h|24h &category=trending|rising|volume|graduation
//        &stage=all|bonding|near_graduation|graduated &minTrades &limit &cursor
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TREND_WINDOWS, TRENDING_CATEGORIES, TRENDING_STAGES } from "@/lib/trending/trending-types";

const schema = z.object({
  timeframe: z.enum(TREND_WINDOWS).default("1h"),
  category: z.enum(TRENDING_CATEGORIES).default("trending"),
  stage: z.enum(TRENDING_STAGES).default("all"),
  minTrades: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const Route = createFileRoute("/api/public/trending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = schema.safeParse(Object.fromEntries(url.searchParams.entries()));
        if (!parsed.success) {
          return Response.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
        }
        try {
          const engine = await import("@/lib/trending/trending-engine.server");
          const { applyTrendingQuery } = await import("@/lib/trending/trending-query");
          const { rows, source } = await engine.getRanking();
          const result = applyTrendingQuery(rows, parsed.data);
          return Response.json(
            { ...result, source },
            { headers: { "cache-control": "public, max-age=30" } },
          );
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Trending ranking unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
