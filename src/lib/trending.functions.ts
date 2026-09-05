// RPC surface for the Trending Engine.
//   • public reads  → ranking + per-token analytics (no auth, no PII)
//   • admin writes  → configuration + manual run (admin session + CSRF)
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TRENDING_CATEGORIES, TREND_WINDOWS, TRENDING_STAGES, type TrendingRow } from "./trending/trending-types";

const timeframeSchema = z.enum(TREND_WINDOWS);
const categorySchema = z.enum(TRENDING_CATEGORIES);
const stageSchema = z.enum(TRENDING_STAGES);
const csrfSchema = z.object({ csrf: z.string().min(10) });

export type TrendingQuery = {
  timeframe?: (typeof TREND_WINDOWS)[number];
  category?: (typeof TRENDING_CATEGORIES)[number];
  stage?: (typeof TRENDING_STAGES)[number];
  minTrades?: number;
  limit?: number;
  cursor?: number;
};

export const trendingQuerySchema = z.object({
  timeframe: timeframeSchema.default("1h"),
  category: categorySchema.default("trending"),
  stage: stageSchema.default("all"),
  minTrades: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.number().int().min(0).max(10_000).default(0),
});

export type TrendingResponse = {
  tokens: TrendingRow[];
  total: number;
  nextCursor: number | null;
  timeframe: string;
  category: string;
  source: string;
  updatedAt: string | null;
};

/** Public ranking. Reads the ranking the SERVER computed; never trusts input. */
export const getTrending = createServerFn({ method: "GET" })
  .inputValidator((d: TrendingQuery | undefined) => trendingQuerySchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<TrendingResponse> => {
    const engine = await import("./trending/trending-engine.server");
    const { rows, source } = await engine.getRanking();
    const { applyTrendingQuery } = await import("./trending/trending-query");
    return { ...applyTrendingQuery(rows, data), source };
  });

/** Analytics block for a single token page. */
export const getTokenTrending = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) =>
    z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const engine = await import("./trending/trending-engine.server");
    const { rows } = await engine.getRanking();
    const needle = data.address.toLowerCase();
    const row = rows.find((r) => r.address.toLowerCase() === needle) ?? null;
    return { row, totalRanked: rows.length };
  });

/* ---------------------------------- admin --------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

const RUN_COOLDOWN_MS = 15_000;
const lastRun = new Map<string, number>();

export const getTrendingOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const cfgMod = await import("./trending/trending-config.server");
    const store = await import("./trending/trending-store.server");
    const [config, state, storage] = await Promise.all([
      cfgMod.loadTrendingConfig(),
      cfgMod.loadTrendingState(),
      store.snapshotsReady(),
    ]);
    return { config, state, storageReady: storage.ready, storageError: storage.error };
  });

export const saveTrendingConfig = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; config: unknown }) =>
    z.object({ csrf: z.string().min(10), config: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const cfgMod = await import("./trending/trending-config.server");
    const current = await cfgMod.loadTrendingConfig();
    let validated;
    try {
      validated = cfgMod.validateTrendingConfig(data.config, current);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Configuración inválida.");
    }
    await cfgMod.saveTrendingConfigValue(validated, adminId);
    await auth.audit("admin.trending.config", adminId, { engine_enabled: validated.engine_enabled });
    return { config: validated };
  });

export const runTrendingNow = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    const previous = lastRun.get(adminId) ?? 0;
    if (now - previous < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el Trending Engine.");
    }
    lastRun.set(adminId, now);
    const engine = await import("./trending/trending-engine.server");
    const result = await engine.runTrendingEngine("admin");
    await auth.audit("admin.trending.run", adminId, { ranked: result.rows.length });
    return { state: result.state, skipped: result.skipped ?? null, ranked: result.rows.length };
  });
