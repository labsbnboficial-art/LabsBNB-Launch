// 🎁 Fase 2F — Rewards engine state + distributed lock (§37).
// Reuses the SAME `admin_config` infrastructure as Points/Leaderboard: no new
// tables, no parallel cron.
import { EMPTY_REWARDS_STATE, type RewardsEngineState } from "./rewards-types";

export const REWARDS_STATE_KEY = "creator_rewards_state";
export const REWARDS_LOCK_KEY = "creator_rewards_lock";
export const REWARDS_LOCK_TTL_MS = 10 * 60_000;

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export async function loadRewardsState(): Promise<RewardsEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", REWARDS_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_REWARDS_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<RewardsEngineState>;
    return { ...EMPTY_REWARDS_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_REWARDS_STATE;
  }
}

export async function saveRewardsState(state: RewardsEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: REWARDS_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[CREATOR_REWARDS] state not persisted: ${error.message}`);
  } catch {
    console.error("[CREATOR_REWARDS] state not persisted: storage unavailable");
  }
}

type LockValue = { token: string; acquiredAt: string; expiresAt: string; scope: string };

export type RewardsLock = { acquired: true; token: string } | { acquired: false; heldSince: string | null };

/**
 * Single-flight lock. `scope` isolates operations that must never overlap for
 * the same program: `run`, `backfill`, `program:<id>`, `rules:<id>`.
 */
export async function acquireRewardsLock(scope: string): Promise<RewardsLock> {
  const now = Date.now();
  const key = `${REWARDS_LOCK_KEY}:${scope}`;
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", key).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    const current = value ? ((typeof value === "string" ? JSON.parse(value) : value) as Partial<LockValue>) : null;
    if (current?.expiresAt && Date.parse(current.expiresAt) > now) {
      return { acquired: false, heldSince: current.acquiredAt ?? null };
    }
    const token = crypto.randomUUID();
    const lock: LockValue = {
      token,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + REWARDS_LOCK_TTL_MS).toISOString(),
      scope,
    };
    await c.from("admin_config").upsert({ key, value: lock, is_public: false }, { onConflict: "key" });
    const { data: check } = await c.from("admin_config").select("value").eq("key", key).maybeSingle();
    const stored = (check as { value?: unknown } | null)?.value;
    const parsed = stored ? ((typeof stored === "string" ? JSON.parse(stored) : stored) as Partial<LockValue>) : null;
    if (parsed?.token !== token) return { acquired: false, heldSince: parsed?.acquiredAt ?? null };
    return { acquired: true, token };
  } catch {
    // Storage unavailable: writes would fail anyway and the engine stays
    // idempotent thanks to the UNIQUE fingerprint.
    return { acquired: true, token: "no-storage" };
  }
}

export async function releaseRewardsLock(scope: string, token: string) {
  if (token === "no-storage") return;
  try {
    const c = await db();
    await c.from("admin_config").upsert(
      {
        key: `${REWARDS_LOCK_KEY}:${scope}`,
        value: { token, acquiredAt: null, expiresAt: new Date(0).toISOString(), scope: "released" },
        is_public: false,
      },
      { onConflict: "key" },
    );
  } catch {
    /* the TTL releases it anyway */
  }
}
