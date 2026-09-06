// 🏆 Creator Points — configuration, engine state and single-flight lock.
// All three live in `admin_config` as PRIVATE keys (never exposed publicly).
import {
  DEFAULT_POINTS_CONFIG,
  EMPTY_POINTS_STATE,
  type CreatorPointsConfig,
  type PointsEngineState,
} from "./points-types";
import { PointsConfigError, validatePointsConfig } from "./points-rules";

export const POINTS_CONFIG_KEY = "creator_points";
export const POINTS_STATE_KEY = "creator_points_state";
export const POINTS_LOCK_KEY = "creator_points_lock";
export const POINTS_LOCK_TTL_MS = 10 * 60_000;

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export async function loadPointsConfig(): Promise<CreatorPointsConfig> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", POINTS_CONFIG_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return DEFAULT_POINTS_CONFIG;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return validatePointsConfig(parsed, DEFAULT_POINTS_CONFIG);
  } catch (e) {
    if (e instanceof PointsConfigError) {
      console.error(`[CREATOR_POINTS] stored configuration invalid, using defaults: ${e.message}`);
    }
    return DEFAULT_POINTS_CONFIG;
  }
}

export async function savePointsConfigValue(cfg: CreatorPointsConfig, adminId: string | null) {
  const c = await db();
  const { configUpdatedBy } = await import("@/lib/config.server");
  const { error } = await c
    .from("admin_config")
    .upsert(
      { key: POINTS_CONFIG_KEY, value: cfg, is_public: false, updated_by: await configUpdatedBy(adminId) },
      { onConflict: "key" },
    );
  if (error) throw new Error(`No se pudo guardar la configuración de Creator Points: ${error.message}`);
}

export async function loadPointsState(): Promise<PointsEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", POINTS_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_POINTS_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<PointsEngineState>;
    return { ...EMPTY_POINTS_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_POINTS_STATE;
  }
}

export async function savePointsState(state: PointsEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: POINTS_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[CREATOR_POINTS] state not persisted: ${error.message}`);
  } catch {
    console.error("[CREATOR_POINTS] state not persisted: storage unavailable");
  }
}

/* ---------------------------------- lock ---------------------------------- */

type LockValue = { token: string; acquiredAt: string; expiresAt: string; trigger: string };

export type PointsLock = { acquired: true; token: string } | { acquired: false; heldSince: string | null };

export async function acquirePointsLock(trigger: string): Promise<PointsLock> {
  const now = Date.now();
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", POINTS_LOCK_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    const current = value ? ((typeof value === "string" ? JSON.parse(value) : value) as Partial<LockValue>) : null;
    if (current?.expiresAt && Date.parse(current.expiresAt) > now) {
      return { acquired: false, heldSince: current.acquiredAt ?? null };
    }
    const token = crypto.randomUUID();
    const lock: LockValue = {
      token,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + POINTS_LOCK_TTL_MS).toISOString(),
      trigger,
    };
    await c.from("admin_config").upsert({ key: POINTS_LOCK_KEY, value: lock, is_public: false }, { onConflict: "key" });
    const { data: check } = await c.from("admin_config").select("value").eq("key", POINTS_LOCK_KEY).maybeSingle();
    const stored = (check as { value?: unknown } | null)?.value;
    const parsed = stored ? ((typeof stored === "string" ? JSON.parse(stored) : stored) as Partial<LockValue>) : null;
    if (parsed?.token !== token) return { acquired: false, heldSince: parsed?.acquiredAt ?? null };
    return { acquired: true, token };
  } catch {
    // Storage unavailable: the ledger insert would fail anyway; the engine is
    // idempotent thanks to the fingerprint UNIQUE constraint.
    return { acquired: true, token: "no-storage" };
  }
}

export async function releasePointsLock(token: string) {
  if (token === "no-storage") return;
  try {
    const c = await db();
    await c.from("admin_config").upsert(
      {
        key: POINTS_LOCK_KEY,
        value: { token, acquiredAt: null, expiresAt: new Date(0).toISOString(), trigger: "released" },
        is_public: false,
      },
      { onConflict: "key" },
    );
  } catch {
    /* the TTL releases it anyway */
  }
}
