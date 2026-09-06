// RPC surface for 🏆 Creator Points.
//   • public reads  → balance + paginated history (no PII, no secrets)
//   • admin writes  → configuration, dry-run, execute, backfill (session + CSRF)
//
// There is NO client-callable mutation of the ledger: points can only be
// created by the server-side engine, and never edited or deleted.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import type { CreatorPointsSummary, PointsLedgerEntry } from "./points/points-types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida.");
const csrfSchema = z.object({ csrf: z.string().min(10) });

export const historySchema = z.object({
  address: addressSchema,
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).max(10_000).default(0),
});

export type CreatorPointsResponse = {
  summary: CreatorPointsSummary;
  ready: boolean;
};

/** Public balance of one creator. Derived from SUM(ledger.points). */
export const getCreatorPoints = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<CreatorPointsResponse> => {
    const store = await import("./points/points-store.server");
    const address = data.address.toLowerCase();
    const ready = await store.ledgerReady();
    if (!ready.ready) {
      return {
        ready: false,
        summary: {
          address,
          chainId: ACTIVE_CHAIN_ID,
          totalPoints: 0,
          pointsToday: 0,
          pointsThisMonth: 0,
          events: 0,
          lastEventAt: null,
          rank: null,
        },
      };
    }
    const totals = await store.creatorTotals(ACTIVE_CHAIN_ID, address);
    return {
      ready: true,
      summary: { address, chainId: ACTIVE_CHAIN_ID, ...totals, rank: null },
    };
  });

export type CreatorPointsHistoryResponse = {
  entries: PointsLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
};

/** Public, paginated points history (newest → oldest). */
export const getCreatorPointsHistory = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string; limit?: number; offset?: number }) => historySchema.parse(d))
  .handler(async ({ data }): Promise<CreatorPointsHistoryResponse> => {
    const store = await import("./points/points-store.server");
    const { entries, total } = await store.creatorHistory(
      ACTIVE_CHAIN_ID,
      data.address.toLowerCase(),
      data.limit,
      data.offset,
    );
    return { entries, total, limit: data.limit, offset: data.offset };
  });

/* ---------------------------------- admin --------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

const RUN_COOLDOWN_MS = 10_000;
const lastRun = new Map<string, number>();

export const getPointsOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const cfgMod = await import("./points/points-config.server");
    const store = await import("./points/points-store.server");
    const [config, state, storage, recent] = await Promise.all([
      cfgMod.loadPointsConfig(),
      cfgMod.loadPointsState(),
      store.ledgerReady(),
      store.recentLedger(ACTIVE_CHAIN_ID, 25),
    ]);
    return {
      config,
      state,
      chainId: ACTIVE_CHAIN_ID,
      storageReady: storage.ready,
      storageError: storage.error,
      recent,
    };
  });

export const savePointsConfig = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; config: unknown }) =>
    z.object({ csrf: z.string().min(10), config: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const cfgMod = await import("./points/points-config.server");
    const rules = await import("./points/points-rules");
    const current = await cfgMod.loadPointsConfig();
    let validated;
    try {
      validated = rules.validatePointsConfig(data.config, current);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Configuración inválida.");
    }
    await cfgMod.savePointsConfigValue(validated, adminId);
    await auth.audit("admin.points.config", adminId, { engine_enabled: validated.engine_enabled });
    return { config: validated };
  });

/** Dry run (preview) or real execution of the Creator Points Engine. */
export const runPointsEngine = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; dryRun?: boolean; startDate?: string | null; endDate?: string | null }) =>
    z
      .object({
        csrf: z.string().min(10),
        dryRun: z.boolean().default(true),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    if (now - (lastRun.get(adminId) ?? 0) < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el Creator Points Engine.");
    }
    lastRun.set(adminId, now);
    const engine = await import("./points/points-engine.server");
    const result = await engine.runCreatorPointsEngine(data.dryRun ? "admin-dry-run" : "admin", {
      dryRun: data.dryRun,
      startDate: data.startDate,
      endDate: data.endDate,
    });
    await auth.audit(data.dryRun ? "admin.points.preview" : "admin.points.run", adminId, {
      events: result.state.eventsEligible,
      points: result.state.pointsAwarded,
    });
    return {
      dryRun: result.dryRun,
      skipped: result.skipped ?? null,
      state: result.state,
      preview: result.candidates.slice(0, 50),
      exclusions: result.exclusions.slice(0, 50),
    };
  });
