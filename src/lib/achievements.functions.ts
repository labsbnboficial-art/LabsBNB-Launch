// 🏆 Creator Achievements — RPC surface (Fase 2D).
//   • public read  → catalog + unlock state of one creator
//   • admin write  → definitions/thresholds, engine run, backfill, history
//
// The browser can NEVER unlock an achievement: no mutation accepts an
// achievement key, an evidence payload or a creator address to award.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import type {
  AchievementsConfig,
  AchievementsRunResult,
  CreatorAchievementsSummary,
} from "./achievements/achievement-types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida.");
const csrfSchema = z.object({ csrf: z.string().min(10) });

/** Public: achievements of one creator, with live progress for locked ones. */
export const getCreatorAchievements = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<CreatorAchievementsSummary> => {
    const { getCreatorAchievements: read } = await import("./achievements/achievement-engine.server");
    return read(data.address, ACTIVE_CHAIN_ID);
  });

/** Public: active catalog (definitions only, no creator data). */
export const getAchievementsCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<AchievementsConfig> => {
    const { loadAchievementsConfig } = await import("./achievements/achievement-config.server");
    return loadAchievementsConfig();
  },
);

/* ---------------------------------- admin --------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { adminId: cur.account.id };
}

export const getAchievementsOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const [cfgMod, storeMod, engineMod] = await Promise.all([
      import("./achievements/achievement-config.server"),
      import("./achievements/achievement-history.server"),
      import("./achievements/achievement-engine.server"),
    ]);
    const [config, state, ready] = await Promise.all([
      cfgMod.loadAchievementsConfig(),
      cfgMod.loadAchievementsState(),
      storeMod.achievementsReady(),
    ]);
    let recent: Awaited<ReturnType<typeof storeMod.recentAchievements>> = [];
    if (ready.ready) {
      try {
        recent = await storeMod.recentAchievements(ACTIVE_CHAIN_ID, 50);
      } catch {
        /* history read failed → panel still shows configuration */
      }
    }
    return {
      config,
      state,
      chainId: ACTIVE_CHAIN_ID,
      storageReady: ready.ready,
      storageError: ready.error,
      recent,
      defaults: engineMod.ACHIEVEMENTS_DEFAULT_CONFIG,
    };
  });

export const saveAchievementsConfig = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; config: unknown }) =>
    z.object({ csrf: z.string().min(10), config: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { adminId } = await admin(data.csrf);
    const [rules, cfgMod] = await Promise.all([
      import("./achievements/achievement-rules"),
      import("./achievements/achievement-config.server"),
    ]);
    const config = rules.validateAchievementsConfig(data.config);
    await cfgMod.saveAchievementsConfigValue(config, adminId);
    return { ok: true as const, config };
  });

const RUN_COOLDOWN_MS = 10_000;
let lastRunAt = 0;

export const runAchievementsEngineFn = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; backfill?: boolean; dryRun?: boolean }) =>
    z.object({ csrf: z.string().min(10), backfill: z.boolean().optional(), dryRun: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<AchievementsRunResult> => {
    await admin(data.csrf);
    const now = Date.now();
    if (now - lastRunAt < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el motor.");
    }
    lastRunAt = now;
    const engine = await import("./achievements/achievement-engine.server");
    return data.backfill
      ? engine.backfillCreatorAchievements(ACTIVE_CHAIN_ID)
      : engine.runAchievementsEngine("admin", { dryRun: data.dryRun });
  });

export const getAchievementsHistory = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; creator?: string | null; key?: string | null; backfill?: boolean | null }) =>
    z
      .object({
        csrf: z.string().min(10),
        creator: addressSchema.nullish(),
        key: z.string().max(40).nullish(),
        backfill: z.boolean().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const store = await import("./achievements/achievement-history.server");
    const ready = await store.achievementsReady();
    if (!ready.ready) return { entries: [], storageReady: false, storageError: ready.error };
    const entries = await store.recentAchievements(ACTIVE_CHAIN_ID, 100, {
      creator: data.creator ?? null,
      key: data.key ?? null,
      backfill: data.backfill ?? null,
    });
    return { entries, storageReady: true, storageError: null as string | null };
  });
