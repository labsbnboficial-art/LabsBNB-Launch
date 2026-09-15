// RPC surface for 🎁 Reward Allocation (Fase 2G).
//   • public read  → allocation of a program, only if the program publishes it
//   • admin writes → allocation config (versioned), dry-run and evaluate
//
// Nothing here distributes tokens, BNB or money: `allocationAmount` is an
// internal calculation of the program and only exists when a reward pool is
// configured.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import type { PublicAllocation } from "./rewards/allocation-types";

const slugSchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "Slug inválido.");
const csrfSchema = z.string().min(10);

/* ---------------------------------- public --------------------------------- */

export const getProgramAllocation = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: slugSchema }).parse(d))
  .handler(async ({ data }): Promise<PublicAllocation> => {
    const engine = await import("./rewards/allocation-engine.server");
    return engine.getPublicAllocation(data.slug);
  });

/* ---------------------------------- admin ---------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

const RUN_COOLDOWN_MS = 10_000;
const lastRun = new Map<string, number>();

export const getAllocationOverview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ csrf: csrfSchema, programId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const engine = await import("./rewards/allocation-engine.server");
    return engine.getAllocationOverview(data.programId);
  });

/** Saving the configuration ALWAYS creates a new immutable version. */
export const updateAllocationConfig = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: csrfSchema,
        programId: z.string().uuid(),
        config: z.unknown(),
        note: z.string().trim().max(200).nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const [rules, allocStore, rewardStore, rewardRules, cfg] = await Promise.all([
      import("./rewards/allocation-rules"),
      import("./rewards/allocation-store.server"),
      import("./rewards/rewards-store.server"),
      import("./rewards/rewards-rules"),
      import("./rewards/rewards-config.server"),
    ]);

    const program = await rewardStore.getProgramById(data.programId);
    if (!program) throw new Error("Programa inexistente.");
    if (rewardRules.isProgramImmutable(program.status)) {
      throw new Error("Un programa finalizado o archivado no admite cambios de allocation.");
    }
    const validated = rules.validateAllocationConfig(data.config);

    const lock = await cfg.acquireRewardsLock(`allocation-config:${program.id}`);
    if (!lock.acquired) throw new Error("Hay una operación en curso sobre este programa. Inténtalo en unos segundos.");
    try {
      const record = await allocStore.saveAllocationConfig(program.id, validated, data.note);
      await auth.audit("reward_allocation.config", adminId, {
        program_id: program.id,
        allocation_version: record.version,
        method: record.config.method,
        pool: record.config.pool.enabled,
      });
      return record;
    } finally {
      await cfg.releaseRewardsLock(`allocation-config:${program.id}`, lock.token);
    }
  });

export const runAllocation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: csrfSchema,
        dryRun: z.boolean().default(true),
        programId: z.string().uuid().nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    if (now - (lastRun.get(adminId) ?? 0) < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el Allocation Engine.");
    }
    lastRun.set(adminId, now);

    const engine = await import("./rewards/allocation-engine.server");
    const result = await engine.runAllocationEngine(data.dryRun ? "admin-dry-run" : "admin", {
      dryRun: data.dryRun,
      ...(data.programId ? { programId: data.programId } : {}),
    });
    await auth.audit(data.dryRun ? "reward_allocation.dry_run" : "reward_allocation.snapshot", adminId, {
      chain_id: ACTIVE_CHAIN_ID,
      programs: result.state.programsEvaluated,
      recipients: result.state.recipients,
      snapshots: result.state.snapshotsCreated,
      duplicates: result.state.duplicates,
      dry_run: data.dryRun,
    });
    return result;
  });
