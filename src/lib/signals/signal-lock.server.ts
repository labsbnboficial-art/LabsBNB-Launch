// Cross-instance execution lock for the Signal Engine.
//
// The engine runs on stateless workers, so an in-memory flag is not enough:
// the lock lives in `admin_config` (key `signal_engine_lock`) so the admin
// button and every cron invocation share the same guard. A stale lock expires
// automatically after LOCK_TTL_MS, so a crashed run can never block the cron
// forever.
export const LOCK_KEY = "signal_engine_lock";
// A full scan of every token can take several minutes (chunked eth_getLogs),
// so the TTL must comfortably exceed the slowest observed run.
export const LOCK_TTL_MS = 15 * 60_000;


type LockValue = { token: string; acquiredAt: string; expiresAt: string; trigger: string };

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

async function read(): Promise<LockValue | null> {
  const c = await db();
  const { data } = await c.from("admin_config").select("value").eq("key", LOCK_KEY).maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  if (!value) return null;
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<LockValue>;
  if (!parsed?.token || !parsed?.expiresAt) return null;
  return parsed as LockValue;
}

export type LockHandle = { token: string };

export type AcquireResult =
  | { acquired: true; handle: LockHandle }
  | { acquired: false; heldSince: string | null; trigger: string | null };

/** Best-effort distributed lock: claim, write, re-read to confirm ownership. */
export async function acquireLock(trigger: string): Promise<AcquireResult> {
  const now = Date.now();
  const current = await read().catch(() => null);
  if (current && Date.parse(current.expiresAt) > now) {
    return { acquired: false, heldSince: current.acquiredAt ?? null, trigger: current.trigger ?? null };
  }

  const token = crypto.randomUUID();
  const value: LockValue = {
    token,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
    trigger,
  };
  const c = await db();
  const { error } = await c
    .from("admin_config")
    .upsert({ key: LOCK_KEY, value, is_public: false }, { onConflict: "key" });
  if (error) {
    // Storage problem: do not block the run, but say so in the logs.
    console.error(`[SIGNAL_LOCK] no se pudo escribir el lock: ${error.message}`);
    return { acquired: true, handle: { token } };
  }

  // Confirm we won the race (last writer wins, so re-read decides).
  const confirmed = await read().catch(() => null);
  if (confirmed && confirmed.token !== token) {
    return { acquired: false, heldSince: confirmed.acquiredAt ?? null, trigger: confirmed.trigger ?? null };
  }
  return { acquired: true, handle: { token } };
}

export async function releaseLock(handle: LockHandle): Promise<void> {
  try {
    const current = await read();
    if (current && current.token !== handle.token) return; // not ours anymore
    const c = await db();
    await c
      .from("admin_config")
      .upsert(
        {
          key: LOCK_KEY,
          value: { token: handle.token, acquiredAt: new Date().toISOString(), expiresAt: new Date(0).toISOString(), trigger: "released" },
          is_public: false,
        },
        { onConflict: "key" },
      );
  } catch (e) {
    console.error(`[SIGNAL_LOCK] no se pudo liberar el lock: ${e instanceof Error ? e.message : "error"}`);
  }
}
