// 🏆 Creator Achievements (Fase 2D) — configuration + engine state.
//
// Audited first: the project already stores every engine configuration in
// `admin_config` (creator_points, creator_levels, trending). We reuse that
// table instead of creating a duplicated configuration table. The public
// definitions table `creator_achievement_definitions` (see SQL doc) is the
// optional, DB-backed catalog: when present it wins for enabled/thresholds.
import {
  DEFAULT_ACHIEVEMENTS_CONFIG,
  EMPTY_ACHIEVEMENTS_STATE,
  type AchievementsConfig,
  type AchievementsEngineState,
} from "./achievement-types";
import { AchievementError, validateAchievementsConfig } from "./achievement-rules";

export const ACHIEVEMENTS_CONFIG_KEY = "creator_achievements";
export const ACHIEVEMENTS_STATE_KEY = "creator_achievements_state";
export const ACHIEVEMENTS_LOCK_KEY = "creator_achievements_lock";
export const ACHIEVEMENTS_LOCK_TTL_MS = 10 * 60_000;

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export async function loadAchievementsConfig(): Promise<AchievementsConfig> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", ACHIEVEMENTS_CONFIG_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return DEFAULT_ACHIEVEMENTS_CONFIG;
    return validateAchievementsConfig(value);
  } catch (e) {
    if (e instanceof AchievementError) {
      console.error(`[CREATOR_ACHIEVEMENTS] stored configuration invalid, using defaults: ${e.message}`);
    }
    return DEFAULT_ACHIEVEMENTS_CONFIG;
  }
}

export async function saveAchievementsConfigValue(cfg: AchievementsConfig, adminId: string | null) {
  const c = await db();
  const { configUpdatedBy } = await import("@/lib/config.server");
  const { error } = await c
    .from("admin_config")
    .upsert(
      { key: ACHIEVEMENTS_CONFIG_KEY, value: cfg, is_public: false, updated_by: await configUpdatedBy(adminId) },
      { onConflict: "key" },
    );
  if (error) throw new Error(`No se pudo guardar la configuración de Achievements: ${error.message}`);

  // Best-effort mirror into the public definitions table (read-only catalog for
  // API consumers). Never destructive: definitions are upserted, never deleted.
  try {
    const rows = cfg.definitions.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      icon: d.icon,
      category: d.category,
      rarity: d.rarity,
      enabled: d.enabled,
      rule_config: d.ruleConfig,
      display_order: d.displayOrder,
      updated_at: new Date().toISOString(),
    }));
    await c.from("creator_achievement_definitions").upsert(rows, { onConflict: "key" });
  } catch {
    /* definitions table not migrated yet → admin_config remains the source */
  }
}

/* ---------------------------------- state --------------------------------- */

export async function loadAchievementsState(): Promise<AchievementsEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", ACHIEVEMENTS_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_ACHIEVEMENTS_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<AchievementsEngineState>;
    return { ...EMPTY_ACHIEVEMENTS_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_ACHIEVEMENTS_STATE;
  }
}

export async function saveAchievementsState(state: AchievementsEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: ACHIEVEMENTS_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[CREATOR_ACHIEVEMENTS] state not persisted: ${error.message}`);
  } catch {
    console.error("[CREATOR_ACHIEVEMENTS] state not persisted: storage unavailable");
  }
}

/* ---------------------------------- lock ---------------------------------- */

type LockValue = { token: string; acquiredAt: string; expiresAt: string; trigger: string };
export type AchievementsLock = { acquired: true; token: string } | { acquired: false; heldSince: string | null };

export async function acquireAchievementsLock(trigger: string): Promise<AchievementsLock> {
  const now = Date.now();
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", ACHIEVEMENTS_LOCK_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    const current = value ? ((typeof value === "string" ? JSON.parse(value) : value) as Partial<LockValue>) : null;
    if (current?.expiresAt && Date.parse(current.expiresAt) > now) {
      return { acquired: false, heldSince: current.acquiredAt ?? null };
    }
    const token = crypto.randomUUID();
    const lock: LockValue = {
      token,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ACHIEVEMENTS_LOCK_TTL_MS).toISOString(),
      trigger,
    };
    await c
      .from("admin_config")
      .upsert({ key: ACHIEVEMENTS_LOCK_KEY, value: lock, is_public: false }, { onConflict: "key" });
    const { data: check } = await c.from("admin_config").select("value").eq("key", ACHIEVEMENTS_LOCK_KEY).maybeSingle();
    const stored = (check as { value?: unknown } | null)?.value;
    const parsed = stored ? ((typeof stored === "string" ? JSON.parse(stored) : stored) as Partial<LockValue>) : null;
    if (parsed?.token !== token) return { acquired: false, heldSince: parsed?.acquiredAt ?? null };
    return { acquired: true, token };
  } catch {
    // Storage unavailable: the UNIQUE fingerprint still guarantees idempotency.
    return { acquired: true, token: "no-storage" };
  }
}

export async function releaseAchievementsLock(token: string) {
  if (token === "no-storage") return;
  try {
    const c = await db();
    await c.from("admin_config").upsert(
      {
        key: ACHIEVEMENTS_LOCK_KEY,
        value: { token, acquiredAt: null, expiresAt: new Date(0).toISOString(), trigger: "released" },
        is_public: false,
      },
      { onConflict: "key" },
    );
  } catch {
    /* the TTL releases it anyway */
  }
}
