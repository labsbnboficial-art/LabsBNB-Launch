// 🏆 Creator Levels — RPC surface (Fase 2C).
//   • public read  → level of one creator, derived server-side from points
//   • public read  → levels configuration (thresholds overview)
//   • admin write  → configuration (session + CSRF)
//
// The client can NEVER assign a level: there is no mutation that accepts a
// `level` or `points` value from the browser.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import type { CreatorLevelResult, CreatorLevelsConfig } from "./levels/levels-types";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida.");
const csrfSchema = z.object({ csrf: z.string().min(10) });

export type CreatorLevelResponse = {
  enabled: boolean;
  address: string;
  chainId: number;
  totalPoints: number;
  level: CreatorLevelResult | null;
  config: CreatorLevelsConfig;
};

/** Public: level + progress of one creator (points come from the ledger). */
export const getCreatorLevel = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<CreatorLevelResponse> => {
    const address = data.address.toLowerCase();
    const [{ loadLevelsConfig }, rules, store] = await Promise.all([
      import("./levels/levels-config.server"),
      import("./levels/levels-rules"),
      import("./points/points-store.server"),
    ]);
    const config = await loadLevelsConfig();
    const ready = await store.ledgerReady();
    const totalPoints = ready.ready ? (await store.creatorTotals(ACTIVE_CHAIN_ID, address)).totalPoints : 0;
    return {
      enabled: config.enabled,
      address,
      chainId: ACTIVE_CHAIN_ID,
      totalPoints,
      level: config.enabled ? rules.calculateCreatorLevel(totalPoints, config) : null,
      config,
    };
  });

/** Public: the level ladder (for the overview modal). No PII, no secrets. */
export const getLevelsConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<CreatorLevelsConfig> => {
    const { loadLevelsConfig } = await import("./levels/levels-config.server");
    return loadLevelsConfig();
  },
);

/* ---------------------------------- admin --------------------------------- */

async function admin(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  return { auth, adminId: cur.account.id };
}

export const getLevelsOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => csrfSchema.parse(d))
  .handler(async ({ data }) => {
    await admin(data.csrf);
    const [{ loadLevelsConfig }, rules] = await Promise.all([
      import("./levels/levels-config.server"),
      import("./levels/levels-rules"),
    ]);
    const config = await loadLevelsConfig();
    return { config, preview: rules.previewLevels(config), chainId: ACTIVE_CHAIN_ID };
  });

export const saveLevelsConfig = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; config: unknown }) =>
    z.object({ csrf: z.string().min(10), config: z.unknown() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { auth, adminId } = await admin(data.csrf);
    const [cfgMod, rules] = await Promise.all([
      import("./levels/levels-config.server"),
      import("./levels/levels-rules"),
    ]);
    let validated;
    try {
      validated = rules.validateLevelsConfig(data.config);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Configuración inválida.");
    }
    await cfgMod.saveLevelsConfigValue(validated, adminId);
    await auth.audit("admin.levels.config", adminId, {
      enabled: validated.enabled,
      levels: validated.levels.length,
    });
    return { config: validated, preview: rules.previewLevels(validated) };
  });
