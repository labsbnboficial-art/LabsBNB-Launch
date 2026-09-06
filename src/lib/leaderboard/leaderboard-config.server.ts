// 🏆 Fase 2E — Leaderboard engine state + distributed lock.
// Reuses the SAME pattern (and the same `admin_config` table) as the Creator
// Points engine: no new infrastructure, no parallel cron.
import { EMPTY_LEADERBOARD_STATE, type LeaderboardEngineState } from "./leaderboard-types";

export const LEADERBOARD_STATE_KEY = "creator_leaderboard_state";
export const LEADERBOARD_LOCK_KEY = "creator_leaderboard_lock";
export const LEADERBOARD_LOCK_TTL_MS = 10 * 60_000;

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export async function loadLeaderboardState(): Promise<LeaderboardEngineState> {
  try {
    const c = await db();
    const { data } = await c.from("admin_config").select("value").eq("key", LEADERBOARD_STATE_KEY).maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!value) return EMPTY_LEADERBOARD_STATE;
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<LeaderboardEngineState>;
    return { ...EMPTY_LEADERBOARD_STATE, ...parsed, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch {
    return EMPTY_LEADERBOARD_STATE;
  }
}

export async function saveLeaderboardState(state: LeaderboardEngineState) {
  try {
    const c = await db();
    const { error } = await c
      .from("admin_config")
      .upsert({ key: LEADERBOARD_STATE_KEY, value: state, is_public: false }, { onConflict: "key" });
    if (error) console.error(`[CREATOR_LEADERBOARD] state not persisted: ${error.message}`);
  } catch {
    console.error("[CREATOR_LEADERBOARD] state not persisted: storage unavailable");
  }
}

type LockValue = { token: string; acquiredAt: string; expiresAt: string; scope: string };

export type LeaderboardLock = { acquired: true; token: string } | { acquired: false; heldSince: string | null };

/**
 * Single-flight lock. `scope` separates concurrent operations that must never
 * overlap for the same target (run / backfill / season finalization).
 */
export async function acquireLeaderboardLock(scope: string): Promise<LeaderboardLock> {
  const now = Date.now();
  const key = `${LEADERBOARD_LOCK_KEY}:${scope}`;
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
      expiresAt: new Date(now + LEADERBOARD_LOCK_TTL_MS).toISOString(),
      scope,
    };
    await c.from("admin_config").upsert({ key, value: lock, is_public: false }, { onConflict: "key" });
    const { data: check } = await c.from("admin_config").select("value").eq("key", key).maybeSingle();
    const stored = (check as { value?: unknown } | null)?.value;
    const parsed = stored ? ((typeof stored === "string" ? JSON.parse(stored) : stored) as Partial<LockValue>) : null;
    if (parsed?.token !== token) return { acquired: false, heldSince: parsed?.acquiredAt ?? null };
    return { acquired: true, token };
  } catch {
    // Storage unavailable: snapshot writes would fail anyway and the engine is
    // idempotent thanks to the UNIQUE fingerprint.
    return { acquired: true, token: "no-storage" };
  }
}

export async function releaseLeaderboardLock(scope: string, token: string) {
  if (token === "no-storage") return;
  try {
    const c = await db();
    await c.from("admin_config").upsert(
      {
        key: `${LEADERBOARD_LOCK_KEY}:${scope}`,
        value: { token, acquiredAt: null, expiresAt: new Date(0).toISOString(), scope: "released" },
        is_public: false,
      },
      { onConflict: "key" },
    );
  } catch {
    /* the TTL releases it anyway */
  }
}
