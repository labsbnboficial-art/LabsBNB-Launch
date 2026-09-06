// 🏆 Creator Levels — persistent configuration.
// Stored in the EXISTING `admin_config` table under the private key
// `creator_levels`. No new table: the level itself is derived state.
import { DEFAULT_LEVELS_CONFIG, type CreatorLevelsConfig } from "./levels-types";
import { LevelsConfigError, validateLevelsConfig } from "./levels-rules";

export const LEVELS_CONFIG_KEY = "creator_levels";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export async function loadLevelsConfig(): Promise<CreatorLevelsConfig> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", LEVELS_CONFIG_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return DEFAULT_LEVELS_CONFIG;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return validateLevelsConfig(parsed);
  } catch (e) {
    if (e instanceof LevelsConfigError) {
      console.error(`[CREATOR_LEVELS] stored configuration invalid, using defaults: ${e.message}`);
    }
    return DEFAULT_LEVELS_CONFIG;
  }
}

export async function saveLevelsConfigValue(cfg: CreatorLevelsConfig, adminId: string | null) {
  const c = await db();
  const { configUpdatedBy } = await import("@/lib/config.server");
  const { error } = await c.from("admin_config").upsert(
    { key: LEVELS_CONFIG_KEY, value: cfg, is_public: false, updated_by: await configUpdatedBy(adminId) },
    { onConflict: "key" },
  );
  if (error) throw new Error(`No se pudo guardar la configuración de Creator Levels: ${error.message}`);
}
