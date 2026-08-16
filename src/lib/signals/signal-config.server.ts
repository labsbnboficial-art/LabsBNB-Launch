// Persistence + server-side validation of the Signal Engine configuration and
// its execution state. Both live in `admin_config` as PRIVATE keys, so the
// thresholds are never exposed to the public config endpoint.
import { DEFAULT_SIGNAL_CONFIG, SIGNAL_TYPES, type SignalConfig, type SignalType } from "./signal-types";

export const CONFIG_KEY = "signal_engine";
export const STATE_KEY = "signal_engine_state";

export type SignalEngineState = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastTrigger: string | null;
  detected: number;
  sent: number;
  skipped: number;
  failed: number;
  tokensScanned: number;
  lastError: string | null;
  notes: string[];
};

export const EMPTY_STATE: SignalEngineState = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastTrigger: null,
  detected: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  tokensScanned: 0,
  lastError: null,
  notes: [],
};

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

/* ------------------------------- validation ------------------------------- */

export class ConfigValidationError extends Error {}

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function req(label: string, v: unknown, min: number, max: number, integer = false): number {
  const n = finite(v);
  if (n === null) throw new ConfigValidationError(`${label}: valor inválido (NaN/Infinity no permitidos).`);
  if (n < min || n > max) throw new ConfigValidationError(`${label}: debe estar entre ${min} y ${max}.`);
  if (integer && !Number.isInteger(n)) throw new ConfigValidationError(`${label}: debe ser un número entero.`);
  return n;
}

/**
 * Server-side validation. Front-end validation is never trusted: every numeric
 * bound (threshold > 0, multiplier > 1, cooldown >= 0, 0 < milestone <= 100) is
 * re-checked here and a violation aborts the whole save.
 */
export function validateConfig(input: unknown, current: SignalConfig = DEFAULT_SIGNAL_CONFIG): SignalConfig {
  const raw = (input ?? {}) as Partial<SignalConfig> & { enabled?: Record<string, unknown> };
  const pick = <K extends keyof SignalConfig>(k: K): unknown => (raw[k] === undefined ? current[k] : raw[k]);

  const enabledIn = (raw.enabled ?? current.enabled) as Record<string, unknown>;
  const enabled = {} as Record<SignalType, boolean>;
  for (const t of SIGNAL_TYPES) {
    const v = enabledIn?.[t];
    enabled[t] = v === undefined ? current.enabled[t] : Boolean(v);
  }

  const milestonesRaw = pick("bonding_milestones");
  if (!Array.isArray(milestonesRaw)) throw new ConfigValidationError("bonding_milestones: debe ser una lista.");
  const milestones = milestonesRaw.map((m, i) => req(`bonding_milestones[${i}]`, m, 0.0001, 100));
  if (!milestones.length) throw new ConfigValidationError("bonding_milestones: define al menos un hito.");
  if (milestones.length > 20) throw new ConfigValidationError("bonding_milestones: máximo 20 hitos.");
  const unique = Array.from(new Set(milestones)).sort((a, b) => a - b);

  const cfg: SignalConfig = {
    engine_enabled: Boolean(pick("engine_enabled")),
    enabled,
    scan_tokens: req("scan_tokens", pick("scan_tokens"), 1, 50, true),
    max_sends_per_run: req("max_sends_per_run", pick("max_sends_per_run"), 1, 30, true),

    volume_min_bnb: req("volume_min_bnb", pick("volume_min_bnb"), 0.0001, 1_000_000),
    volume_multiplier: req("volume_multiplier", pick("volume_multiplier"), 1.0001, 1000),
    volume_window_min: req("volume_window_min", pick("volume_window_min"), 1, 1440, true),
    volume_cooldown_min: req("volume_cooldown_min", pick("volume_cooldown_min"), 0, 10_080, true),
    volume_min_baseline_windows: req("volume_min_baseline_windows", pick("volume_min_baseline_windows"), 1, 24, true),

    whale_buy_bnb: req("whale_buy_bnb", pick("whale_buy_bnb"), 0.0001, 1_000_000),
    whale_sell_bnb: req("whale_sell_bnb", pick("whale_sell_bnb"), 0.0001, 1_000_000),
    whale_cooldown_min: req("whale_cooldown_min", pick("whale_cooldown_min"), 0, 10_080, true),

    bonding_milestones: unique,
    ath_min_change_pct: req("ath_min_change_pct", pick("ath_min_change_pct"), 0, 10_000),
    ath_cooldown_min: req("ath_cooldown_min", pick("ath_cooldown_min"), 0, 10_080, true),
    koth_cooldown_min: req("koth_cooldown_min", pick("koth_cooldown_min"), 0, 10_080, true),
    new_token_cooldown_min: req("new_token_cooldown_min", pick("new_token_cooldown_min"), 0, 10_080, true),
    graduation_cooldown_min: req("graduation_cooldown_min", pick("graduation_cooldown_min"), 0, 10_080, true),
  };
  return cfg;
}

/* -------------------------------- storage --------------------------------- */

export async function loadConfig(): Promise<SignalConfig> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", CONFIG_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return DEFAULT_SIGNAL_CONFIG;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return validateConfig(parsed, DEFAULT_SIGNAL_CONFIG);
  } catch (e) {
    if (e instanceof ConfigValidationError) {
      console.error(`[SIGNAL_ENGINE] stored configuration invalid, using defaults: ${e.message}`);
      return DEFAULT_SIGNAL_CONFIG;
    }
    throw e;
  }
}

export async function saveConfig(cfg: SignalConfig, adminId: string | null) {
  const c = await db();
  const { configUpdatedBy } = await import("@/lib/config.server");
  const { error } = await c
    .from("admin_config")
    .upsert(
      { key: CONFIG_KEY, value: cfg, is_public: false, updated_by: await configUpdatedBy(adminId) },
      { onConflict: "key" },
    );
  if (error) throw new Error(`No se pudo guardar la configuración de señales: ${error.message}`);
}

export async function loadState(): Promise<SignalEngineState> {
  const c = await db();
  const { data } = await c.from("admin_config").select("value").eq("key", STATE_KEY).maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  if (!value) return EMPTY_STATE;
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<SignalEngineState>;
  return { ...EMPTY_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
}

export async function saveState(state: SignalEngineState) {
  const c = await db();
  const { error } = await c
    .from("admin_config")
    .upsert({ key: STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
  if (error) console.error(`[SIGNAL_ENGINE] no se pudo persistir el estado: ${error.message}`);
}
