// RPC surface for 🏆 Creator Leaderboard + 🗓️ Creator Seasons (Fase 2E).
//   • public reads  → ranking, seasons, per-creator position (no PII/secrets)
//   • admin writes  → seasons lifecycle, snapshots, backfill (session + CSRF)
//
// There is NO client-callable mutation of ranks, points, scores or snapshots.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  DEFAULT_SEASON_RULES,
  LEADERBOARD_CATEGORIES,
  SEASON_STATUSES,
  type CreatorLeaderboardSummary,
  type LeaderboardCategory,
  type LeaderboardPage,
} from "./leaderboard/leaderboard-types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida.");
const csrfSchema = z.object({ csrf: z.string().min(10) });
const categorySchema = z.enum(LEADERBOARD_CATEGORIES).default("overall");
const slugSchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "Slug inválido.");

export const leaderboardQuerySchema = z.object({
  category: categorySchema,
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

/* ---------------------------------- public --------------------------------- */

export const getLeaderboard = createServerFn({ method: "GET" })
  .inputValidator((d: { category?: LeaderboardCategory; page?: number; pageSize?: number }) =>
    leaderboardQuerySchema.parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<LeaderboardPage> => {
    const engine = await import("./leaderboard/leaderboard-engine.server");
    return engine.getLeaderboardPage(data);
  });

export const getActiveSeason = createServerFn({ method: "GET" }).handler(async () => {
  const engine = await import("./leaderboard/leaderboard-engine.server");
  return { season: await engine.getActiveSeasonView(), chainId: ACTIVE_CHAIN_ID };
});

export const getSeasons = createServerFn({ method: "GET" }).handler(async () => {
  const engine = await import("./leaderboard/leaderboard-engine.server");
  return { seasons: await engine.listSeasonSummaries(), chainId: ACTIVE_CHAIN_ID };
});

export const getSeason = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: slugSchema }).parse(d))
  .handler(async ({ data }) => {
    const engine = await import("./leaderboard/leaderboard-engine.server");
    return engine.getSeasonDetail(data.slug);
  });

export const getCreatorLeaderboardPosition = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<CreatorLeaderboardSummary> => {
    const engine = await import("./leaderboard/leaderboard-engine.server");
    return engine.getCreatorLeaderboardSummary(data.address);
  });

/* ---------------------------------- admin ---------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

const RUN_COOLDOWN_MS = 10_000;
const lastRun = new Map<string, number>();

export const getLeaderboardOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const [cfg, store, engine] = await Promise.all([
      import("./leaderboard/leaderboard-config.server"),
      import("./leaderboard/leaderboard-store.server"),
      import("./leaderboard/leaderboard-engine.server"),
    ]);
    const [state, snapshotsReady, seasonsReady, activeSeason, seasons] = await Promise.all([
      cfg.loadLeaderboardState(),
      store.leaderboardReady(),
      store.seasonsReady(),
      engine.getActiveSeasonView(),
      engine.listSeasonSummaries(),
    ]);
    return {
      chainId: ACTIVE_CHAIN_ID,
      state,
      storageReady: snapshotsReady.ready && seasonsReady.ready,
      storageError: snapshotsReady.error ?? seasonsReady.error,
      activeSeason,
      seasons,
    };
  });

export const runLeaderboard = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; dryRun?: boolean; backfill?: boolean }) =>
    z.object({ csrf: z.string().min(10), dryRun: z.boolean().default(false), backfill: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    if (now - (lastRun.get(adminId) ?? 0) < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el Leaderboard Engine.");
    }
    lastRun.set(adminId, now);
    const engine = await import("./leaderboard/leaderboard-engine.server");
    const result = await engine.runLeaderboardEngine(data.backfill ? "admin-backfill" : "admin", {
      dryRun: data.dryRun,
      backfill: data.backfill,
    });
    await auth.audit(data.backfill ? "leaderboard.backfill" : "leaderboard.snapshot", adminId, {
      creators: result.state.creatorsEvaluated,
      snapshots: result.state.snapshotsCreated,
      dry_run: data.dryRun,
    });
    return result;
  });

const seasonInputSchema = z.object({
  csrf: z.string().min(10),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  startsAt: z.string().min(4),
  endsAt: z.string().min(4),
  rules: z.unknown().optional(),
});

export const createSeason = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => seasonInputSchema.parse(d))
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./leaderboard/leaderboard-rules");
    const store = await import("./leaderboard/leaderboard-store.server");

    const dates = rules.validateSeasonDates(data.startsAt, data.endsAt);
    const validated = data.rules === undefined ? DEFAULT_SEASON_RULES : rules.validateSeasonRules(data.rules);
    const slug = rules.slugify(data.name);

    const existing = await store.listSeasons(ACTIVE_CHAIN_ID);
    if (existing.some((s) => s.slug === slug)) throw new Error("Ya existe una temporada con ese nombre/slug.");

    const season = await store.insertSeason({
      chainId: ACTIVE_CHAIN_ID,
      name: data.name,
      slug,
      description: data.description,
      status: "draft",
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      rules: validated,
    });
    await auth.audit("season.create", adminId, { season_id: season.id, slug: season.slug });
    return { season };
  });

export const updateSeasonDraft = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: z.string().min(10),
        id: z.string().uuid(),
        name: z.string().trim().min(3).max(80).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        startsAt: z.string().min(4).optional(),
        endsAt: z.string().min(4).optional(),
        rules: z.unknown().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./leaderboard/leaderboard-rules");
    const store = await import("./leaderboard/leaderboard-store.server");

    const current = await store.getSeasonById(data.id);
    if (!current) throw new Error("Temporada inexistente.");
    if (rules.isSeasonImmutable(current.status)) {
      throw new Error("Una temporada finalizada o archivada es inmutable y no puede modificarse.");
    }

    const startsAt = data.startsAt ?? current.startsAt;
    const endsAt = data.endsAt ?? current.endsAt;
    const dates = rules.validateSeasonDates(startsAt, endsAt);
    const validatedRules = data.rules === undefined ? current.rules : rules.validateSeasonRules(data.rules);

    const season = await store.updateSeason(data.id, {
      ...(data.name ? { name: data.name, slug: rules.slugify(data.name) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      rules: validatedRules,
    });
    await auth.audit("season.update", adminId, { season_id: season.id, slug: season.slug });
    return { season };
  });

export const transitionSeason = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: z.string().min(10),
        id: z.string().uuid(),
        to: z.enum(SEASON_STATUSES),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./leaderboard/leaderboard-rules");
    const store = await import("./leaderboard/leaderboard-store.server");
    const engine = await import("./leaderboard/leaderboard-engine.server");

    const current = await store.getSeasonById(data.id);
    if (!current) throw new Error("Temporada inexistente.");
    rules.assertTransition(current.status, data.to);

    if (data.to === "active") {
      const active = await store.getActiveSeason(ACTIVE_CHAIN_ID);
      if (active && active.id !== current.id) {
        throw new Error(`Ya existe una temporada activa ("${active.name}"). Finalízala antes de activar otra.`);
      }
      const others = (await store.listSeasons(ACTIVE_CHAIN_ID)).filter(
        (s) => s.id !== current.id && (s.status === "active" || s.status === "scheduled"),
      );
      const overlap = others.find((s) => rules.seasonsOverlap(current, s));
      if (overlap) throw new Error(`La temporada se solapa con "${overlap.name}".`);
    }

    let finalization: Awaited<ReturnType<typeof engine.finalizeSeason>> | null = null;
    if (data.to === "ended") {
      finalization = await engine.finalizeSeason(current.id, "admin");
    }

    const season = await store.updateSeason(current.id, {
      status: data.to,
      ...(data.to === "ended" ? { finalizedAt: new Date().toISOString() } : {}),
    });

    const action =
      data.to === "active"
        ? "season.activate"
        : data.to === "ended"
          ? "season.end"
          : data.to === "archived"
            ? "season.archive"
            : "season.schedule";
    await auth.audit(action, adminId, { season_id: season.id, slug: season.slug, to: data.to });
    return { season, finalization };
  });

export const createSeasonSnapshot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ csrf: z.string().min(10), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const engine = await import("./leaderboard/leaderboard-engine.server");
    const result = await engine.finalizeSeason(data.id, "admin-manual-final");
    await auth.audit("leaderboard.snapshot", adminId, { season_id: data.id, inserted: result.inserted, final: true });
    return result;
  });
