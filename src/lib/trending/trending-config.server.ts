// Trending Engine — configuration, state and cross-instance lock.
// All three live in `admin_config` as PRIVATE keys (never exposed publicly).
import {
  DEFAULT_TRENDING_CONFIG,
  EMPTY_TRENDING_STATE,
  type TrendingConfig,
  type TrendingEngineState,
  type TrendingWeights,
} from "./trending-types";

export const TRENDING_CONFIG_KEY = "trending_engine";
export const TRENDING_STATE_KEY = "trending_engine_state";
export const TRENDING_LOCK_KEY = "trending_engine_lock";
export const LOCK_TTL_MS = 10 * 60_000;

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export class TrendingConfigError extends Error {}

function num(label: string, v: unknown, min: number, max: number, integer = false): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new TrendingConfigError(`${label}: valor inválido.`);
  if (n < min || n > max) throw new TrendingConfigError(`${label}: debe estar entre ${min} y ${max}.`);
  if (integer && !Number.isInteger(n)) throw new TrendingConfigError(`${label}: debe ser entero.`);
  return n;
}

/** Server-side validation. Frontend input is never trusted. */
export function validateTrendingConfig(
  input: unknown,
  current: TrendingConfig = DEFAULT_TRENDING_CONFIG,
): TrendingConfig {
  const raw = (input ?? {}) as Partial<TrendingConfig>;
  const pick = <K extends keyof TrendingConfig>(k: K): unknown => (raw[k] === undefined ? current[k] : raw[k]);

  const weightsIn = (raw.weights ?? current.weights) as Partial<TrendingWeights>;
  const weights: TrendingWeights = {
    momentum: num("weights.momentum", weightsIn.momentum ?? current.weights.momentum, 0, 100),
    buyers: num("weights.buyers", weightsIn.buyers ?? current.weights.buyers, 0, 100),
    holders: num("weights.holders", weightsIn.holders ?? current.weights.holders, 0, 100),
    bonding: num("weights.bonding", weightsIn.bonding ?? current.weights.bonding, 0, 100),
    whales: num("weights.whales", weightsIn.whales ?? current.weights.whales, 0, 100),
    activity: num("weights.activity", weightsIn.activity ?? current.weights.activity, 0, 100),
  };
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) throw new TrendingConfigError("weights: la suma debe ser mayor que 0.");

  const interval = num("scan_interval_min", pick("scan_interval_min"), 1, 60, true);

  return {
    engine_enabled: Boolean(pick("engine_enabled")),
    scan_interval_min: interval,
    scan_tokens: num("scan_tokens", pick("scan_tokens"), 1, 100, true),
    weights,
    min_trades_24h: num("min_trades_24h", pick("min_trades_24h"), 0, 1000, true),
    velocity_threshold: num("velocity_threshold", pick("velocity_threshold"), 0, 100_000),
    near_graduation_pct: num("near_graduation_pct", pick("near_graduation_pct"), 1, 100),
    whale_bnb: num("whale_bnb", pick("whale_bnb"), 0.0001, 10_000),
  };
}

export async function loadTrendingConfig(): Promise<TrendingConfig> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", TRENDING_CONFIG_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return DEFAULT_TRENDING_CONFIG;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return validateTrendingConfig(parsed, DEFAULT_TRENDING_CONFIG);
  } catch (e) {
    if (e instanceof TrendingConfigError) {
      console.error(`[TRENDING_ENGINE] stored configuration invalid, using defaults: ${e.message}`);
      return DEFAULT_TRENDING_CONFIG;
    }
    console.error("[TRENDING_ENGINE] configuration unavailable, using defaults");
    return DEFAULT_TRENDING_CONFIG;
  }
}

export async function saveTrendingConfigValue(cfg: TrendingConfig, adminId: string | null) {
  const c = await db();
  const { configUpdatedBy } = await import("@/lib/config.server");
  const { error } = await c
    .from("admin_config")
    .upsert(
      { key: TRENDING_CONFIG_KEY, value: cfg, is_public: false, updated_by: await configUpdatedBy(adminId) },
      { onConflict: "key" },
    );
  if (error) throw new Error(`No se pudo guardar la configuración de Trending: ${error.message}`);
}

export async function loadTrendingState(): Promise<TrendingEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", TRENDING_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_TRENDING_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<TrendingEngineState>;
    return { ...EMPTY_TRENDING_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_TRENDING_STATE;
  }
}

export async function saveTrendingState(state: TrendingEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: TRENDING_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[TRENDING_ENGINE] state not persisted: ${error.message}`);
  } catch {
    console.error("[TRENDING_ENGINE] state not persisted: storage unavailable");
  }
}

/* ---------------------------------- lock ---------------------------------- */

type LockValue = { token: string; acquiredAt: string; expiresAt: string; trigger: string };

export type AcquireResult =
  | { acquired: true; token: string }
  | { acquired: false; heldSince: string | null };

/** Single-flight guard shared by the admin button and the cron endpoint. */
export async function acquireTrendingLock(trigger: string): Promise<AcquireResult> {
  const now = Date.now();
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", TRENDING_LOCK_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    const current = value ? ((typeof value === "string" ? JSON.parse(value) : value) as Partial<LockValue>) : null;
    if (current?.expiresAt && Date.parse(current.expiresAt) > now) {
      return { acquired: false, heldSince: current.acquiredAt ?? null };
    }
    const token = crypto.randomUUID();
    const lock: LockValue = {
      token,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
      trigger,
    };
    await c.from("admin_config").upsert({ key: TRENDING_LOCK_KEY, value: lock, is_public: false }, { onConflict: "key" });
    const { data: check } = await c.from("admin_config").select("value").eq("key", TRENDING_LOCK_KEY).maybeSingle();
    const stored = (check as { value?: unknown } | null)?.value;
    const parsed = stored ? ((typeof stored === "string" ? JSON.parse(stored) : stored) as Partial<LockValue>) : null;
    if (parsed?.token !== token) return { acquired: false, heldSince: parsed?.acquiredAt ?? null };
    return { acquired: true, token };
  } catch {
    // Storage unavailable: run anyway (the engine is idempotent and read-only
    // against the chain), but never silently pretend a lock exists.
    return { acquired: true, token: "no-storage" };
  }
}

export async function releaseTrendingLock(token: string) {
  if (token === "no-storage") return;
  try {
    const c = await db();
    await c.from("admin_config").upsert(
      { key: TRENDING_LOCK_KEY, value: { token, acquiredAt: null, expiresAt: new Date(0).toISOString(), trigger: "released" }, is_public: false },
      { onConflict: "key" },
    );
  } catch {
    /* the TTL releases it anyway */
  }
}
