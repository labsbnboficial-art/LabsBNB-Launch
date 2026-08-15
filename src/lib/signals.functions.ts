// Admin-only RPC surface for the Signal Engine.
// Every handler is gated by the admin session + CSRF token; nothing here ever
// returns the bot token or the cron secret.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SIGNAL_TYPES } from "./signals/signal-types";

const csrfSchema = z.object({ csrf: z.string().min(10) });
const typeSchema = z.enum(SIGNAL_TYPES);

const RUN_COOLDOWN_MS = 15_000;
const lastRun = new Map<string, number>();

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

/** Config + engine state + counters + storage health. */
export const getSignalOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const cfgMod = await import("./signals/signal-config.server");
    const dedupe = await import("./signals/signal-dedupe.server");

    const storage = await dedupe.storageReady();
    const config = await cfgMod.loadConfig();
    const state = storage.ready ? await cfgMod.loadState() : cfgMod.EMPTY_STATE;
    const counts = storage.ready
      ? await dedupe.signalCounts().catch(() => ({ SENT: 0, SKIPPED: 0, FAILED: 0, TOTAL: 0 }))
      : { SENT: 0, SKIPPED: 0, FAILED: 0, TOTAL: 0 };

    return { config, state, counts, storageReady: storage.ready, storageError: storage.error };
  });

export const saveSignalConfig = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; config: unknown }) =>
    z.object({ csrf: z.string().min(10), config: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const cfgMod = await import("./signals/signal-config.server");
    const current = await cfgMod.loadConfig();
    let validated;
    try {
      validated = cfgMod.validateConfig(data.config, current);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Configuración inválida.");
    }
    await cfgMod.saveConfig(validated, adminId);
    await auth.audit("admin.signals.config", adminId, { engine_enabled: validated.engine_enabled });
    return { config: validated };
  });

/** Executes the REAL engine once (same code path as the cron endpoint). */
export const runSignalsNow = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const now = Date.now();
    const prev = lastRun.get(adminId) ?? 0;
    if (now - prev < RUN_COOLDOWN_MS) {
      throw new Error(`Espera ${Math.ceil((RUN_COOLDOWN_MS - (now - prev)) / 1000)}s antes de volver a ejecutar.`);
    }
    lastRun.set(adminId, now);

    const { runSignalEngine } = await import("./signals/signal-engine.server");
    const result = await runSignalEngine({ trigger: `admin:${adminId}` });
    await auth.audit("admin.signals.run", adminId, {
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
    });
    return result;
  });

/** Renders a signal exactly as it would be published. Never sends. */
export const previewSignal = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; type: string; address?: string }) =>
    z
      .object({ csrf: z.string().min(10), type: typeSchema, address: z.string().trim().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const fmt = await import("./signals/signal-formatters");
    const base = fmt.siteUrl();

    if (data.address) {
      const { buildPreviewCandidate } = await import("./signals/signal-engine.server");
      const candidate = await buildPreviewCandidate(data.type, data.address).catch(() => null);
      if (candidate) {
        const rendered = fmt.renderSignal(candidate, base);
        return { real: true as const, text: rendered.text, buttons: rendered.buttons };
      }
    }
    const rendered = fmt.renderTestSignal(data.type, base);
    return { real: false as const, text: rendered.text, buttons: rendered.buttons };
  });

export const listSignalHistory = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      csrf: string;
      status?: string;
      type?: string;
      token?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    }) =>
      z
        .object({
          csrf: z.string().min(10),
          status: z.enum(["SENT", "SKIPPED", "FAILED"]).optional(),
          type: typeSchema.optional(),
          token: z.string().trim().max(64).optional(),
          from: z.string().trim().max(40).optional(),
          to: z.string().trim().max(40).optional(),
          page: z.number().int().min(1).max(1000).optional(),
          pageSize: z.number().int().min(5).max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const { querySignals } = await import("./signals/signal-history.server");
    try {
      return await querySignals({
        status: data.status ?? null,
        type: data.type ?? null,
        token: data.token ?? null,
        from: data.from ? new Date(data.from).toISOString() : null,
        to: data.to ? new Date(`${data.to}T23:59:59Z`).toISOString() : null,
        page: data.page ?? 1,
        pageSize: data.pageSize ?? 25,
      });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "No se pudo leer el historial de señales.");
    }
  });
