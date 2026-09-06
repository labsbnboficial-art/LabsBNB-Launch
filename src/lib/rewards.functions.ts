// RPC surface for 🎁 Creator Rewards & Airdrop Eligibility (Fase 2F).
//   • public reads  → programs, eligibility tables, per-creator criteria
//   • admin writes  → program lifecycle, rule versions, evaluate/backfill
//
// The client NEVER sends points, score, level, achievements or ranks: it only
// requests an evaluation. Nothing here distributes tokens, BNB or money.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import {
  ELIGIBILITY_STATUSES,
  EVALUATION_WINDOWS,
  REWARD_PROGRAM_STATUSES,
  type CreatorRewardsSummary,
  type EligibilityPage,
  type EligibilityStatus,
} from "./rewards/rewards-types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida.");
const slugSchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "Slug inválido.");
const csrfSchema = z.string().min(10);

/* ---------------------------------- public --------------------------------- */

export const getRewardPrograms = createServerFn({ method: "GET" }).handler(async () => {
  const engine = await import("./rewards/rewards-engine.server");
  return engine.listPublicPrograms();
});

export const getRewardProgram = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: slugSchema }).parse(d))
  .handler(async ({ data }) => {
    const engine = await import("./rewards/rewards-engine.server");
    return { program: await engine.getProgramView(data.slug), chainId: ACTIVE_CHAIN_ID };
  });

export const getRewardEligibility = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string; filter?: EligibilityStatus | "all"; page?: number; pageSize?: number }) =>
    z
      .object({
        slug: slugSchema,
        filter: z.enum(["all", ...ELIGIBILITY_STATUSES]).default("all"),
        page: z.number().int().min(1).max(1000).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<EligibilityPage> => {
    const engine = await import("./rewards/rewards-engine.server");
    return engine.getEligibilityPage(data);
  });

export const getCreatorRewardEligibility = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<CreatorRewardsSummary> => {
    const engine = await import("./rewards/rewards-engine.server");
    return engine.getCreatorRewards(data.address);
  });

/* ---------------------------------- admin ---------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

const RUN_COOLDOWN_MS = 10_000;
const lastRun = new Map<string, number>();

export const getRewardsOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => z.object({ csrf: csrfSchema }).parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const [cfg, store, engine, lb] = await Promise.all([
      import("./rewards/rewards-config.server"),
      import("./rewards/rewards-store.server"),
      import("./rewards/rewards-engine.server"),
      import("@/lib/leaderboard/leaderboard-store.server"),
    ]);
    const [state, ready, programs, seasons] = await Promise.all([
      cfg.loadRewardsState(),
      store.rewardsReady(),
      store.listPrograms(ACTIVE_CHAIN_ID),
      lb.listSeasons(ACTIVE_CHAIN_ID),
    ]);
    const detailed = await Promise.all(
      programs.map(async (p) => ({
        program: p,
        stats: await store.programStats(ACTIVE_CHAIN_ID, p.id),
        versions: await store.listRuleVersions(p.id),
      })),
    );
    void engine;
    return {
      chainId: ACTIVE_CHAIN_ID,
      state,
      storageReady: ready.ready,
      storageError: ready.error,
      programs: detailed,
      seasons: seasons.map((s) => ({ id: s.id, name: s.name, slug: s.slug, startsAt: s.startsAt, endsAt: s.endsAt })),
    };
  });

const programInputSchema = z.object({
  csrf: csrfSchema,
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  startsAt: z.string().min(4).nullable().default(null),
  endsAt: z.string().min(4).nullable().default(null),
  seasonId: z.string().uuid().nullable().default(null),
  evaluationWindow: z.enum(EVALUATION_WINDOWS).default("current"),
  evaluationStart: z.string().min(4).nullable().default(null),
  evaluationEnd: z.string().min(4).nullable().default(null),
  rules: z.unknown().optional(),
});

export const createRewardProgram = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => programInputSchema.parse(d))
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./rewards/rewards-rules");
    const store = await import("./rewards/rewards-store.server");
    const { DEFAULT_REWARD_RULES } = await import("./rewards/rewards-types");

    const dates = rules.validateProgramDates(data.startsAt, data.endsAt);
    const validated = data.rules === undefined ? DEFAULT_REWARD_RULES : rules.validateRewardRules(data.rules);
    const slug = rules.slugify(data.name);
    if (!slug) throw new Error("El nombre del programa no genera un slug válido.");

    const existing = await store.listPrograms(ACTIVE_CHAIN_ID);
    if (existing.some((p) => p.slug === slug)) throw new Error("Ya existe un programa con ese nombre/slug.");

    if (data.evaluationWindow === "season" && !data.seasonId) throw new Error("Selecciona una temporada para este programa.");
    if (data.evaluationWindow === "historical") {
      rules.validateProgramDates(data.evaluationStart, data.evaluationEnd);
      if (!data.evaluationStart || !data.evaluationEnd) throw new Error("Una ventana histórica requiere inicio y fin.");
    }

    const program = await store.insertProgram({
      chainId: ACTIVE_CHAIN_ID,
      name: data.name,
      slug,
      description: data.description,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      seasonId: data.evaluationWindow === "season" ? data.seasonId : null,
      evaluationWindow: data.evaluationWindow,
      evaluationStart: data.evaluationWindow === "historical" ? data.evaluationStart : null,
      evaluationEnd: data.evaluationWindow === "historical" ? data.evaluationEnd : null,
      rules: validated,
    });
    await auth.audit("reward_program.create", adminId, { program_id: program.id, slug: program.slug });
    return { program };
  });

export const updateRewardProgramDraft = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: csrfSchema,
        id: z.string().uuid(),
        name: z.string().trim().min(3).max(80).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        startsAt: z.string().min(4).nullable().optional(),
        endsAt: z.string().min(4).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./rewards/rewards-rules");
    const store = await import("./rewards/rewards-store.server");

    const current = await store.getProgramById(data.id);
    if (!current) throw new Error("Programa inexistente.");
    if (rules.isProgramImmutable(current.status)) {
      throw new Error("Un programa finalizado o archivado es inmutable y no puede modificarse.");
    }
    const dates = rules.validateProgramDates(
      data.startsAt === undefined ? current.startsAt : data.startsAt,
      data.endsAt === undefined ? current.endsAt : data.endsAt,
    );
    const program = await store.updateProgram(data.id, {
      ...(data.name ? { name: data.name, slug: rules.slugify(data.name) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
    });
    await auth.audit("reward_program.update", adminId, { program_id: program.id, slug: program.slug });
    return { program };
  });

/** §23 — editing the rules ALWAYS creates a new immutable rule version. */
export const updateRewardRules = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ csrf: csrfSchema, id: z.string().uuid(), rules: z.unknown(), note: z.string().trim().max(200).nullable().default(null) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rulesMod = await import("./rewards/rewards-rules");
    const store = await import("./rewards/rewards-store.server");
    const cfg = await import("./rewards/rewards-config.server");

    const current = await store.getProgramById(data.id);
    if (!current) throw new Error("Programa inexistente.");
    if (rulesMod.isProgramImmutable(current.status)) {
      throw new Error("Un programa finalizado o archivado no admite cambios de reglas.");
    }
    const validated = rulesMod.validateRewardRules(data.rules);

    // §37 — never migrate rules while an evaluation of this program is running.
    const lock = await cfg.acquireRewardsLock(`rules:${current.id}`);
    if (!lock.acquired) throw new Error("Hay una operación en curso sobre este programa. Inténtalo en unos segundos.");
    try {
      const nextVersion = current.ruleVersion + 1;
      await store.insertRuleVersion(current.id, nextVersion, validated, data.note);
      const program = await store.updateProgram(current.id, { rules: validated, ruleVersion: nextVersion });
      await auth.audit("reward_rules.update", adminId, { program_id: program.id, rule_version: nextVersion });
      return { program };
    } finally {
      await cfg.releaseRewardsLock(`rules:${current.id}`, lock.token);
    }
  });

export const transitionRewardProgram = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ csrf: csrfSchema, id: z.string().uuid(), to: z.enum(REWARD_PROGRAM_STATUSES) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const rules = await import("./rewards/rewards-rules");
    const store = await import("./rewards/rewards-store.server");

    const current = await store.getProgramById(data.id);
    if (!current) throw new Error("Programa inexistente.");
    rules.assertProgramTransition(current.status, data.to);

    const program = await store.updateProgram(current.id, { status: data.to });
    const action =
      data.to === "active"
        ? "reward_program.activate"
        : data.to === "ended"
          ? "reward_program.end"
          : data.to === "archived"
            ? "reward_program.archive"
            : "reward_program.update";
    await auth.audit(action, adminId, { program_id: program.id, status: program.status });
    return { program };
  });

export const runRewardsEvaluation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        csrf: csrfSchema,
        dryRun: z.boolean().default(false),
        backfill: z.boolean().default(false),
        programId: z.string().uuid().nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    if (now - (lastRun.get(adminId) ?? 0) < RUN_COOLDOWN_MS) {
      throw new Error("Espera unos segundos antes de volver a ejecutar el Eligibility Engine.");
    }
    lastRun.set(adminId, now);

    const engine = await import("./rewards/rewards-engine.server");
    const result = await engine.runRewardsEngine(data.backfill ? "admin-backfill" : "admin", {
      dryRun: data.dryRun,
      backfill: data.backfill,
      ...(data.programId ? { programId: data.programId } : {}),
    });
    await auth.audit(
      data.dryRun ? "eligibility.run" : data.backfill ? "eligibility.backfill" : "eligibility.snapshot",
      adminId,
      {
        programs: result.state.programsEvaluated,
        creators: result.state.creatorsEvaluated,
        eligible: result.state.eligible,
        snapshots: result.state.snapshotsCreated,
        dry_run: data.dryRun,
      },
    );
    return result;
  });

export const getRewardProgramAudit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ csrf: csrfSchema, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const store = await import("./rewards/rewards-store.server");
    const [versions, snapshots] = await Promise.all([
      store.listRuleVersions(data.id),
      store.recentSnapshots(ACTIVE_CHAIN_ID, data.id, 25),
    ]);
    return { versions, snapshots };
  });
