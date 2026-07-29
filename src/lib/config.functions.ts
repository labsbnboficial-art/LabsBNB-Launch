import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Config reads/writes go through the server so they don't depend on RLS.
 * Admin writes are gated by the username/password + PIN admin session
 * (see src/lib/admin-auth.server.ts) — no wallet signature involved.
 */

function toScalar(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  const { data, error } = await adminClient
    .from("admin_config")
    .select("key,value")
    .eq("is_public", true);
  if (error) throw new Error(error.message);
  const map: Record<string, string | number | boolean | null> = {};
  (data ?? []).forEach((r: { key: string; value: unknown }) => { map[r.key] = toScalar(r.value); });
  return map;
});

async function adminGate(csrf: string) {
  const m = await import("@/lib/admin-auth.server");
  await m.requireAdmin(csrf);
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient;
}

export const getAdminConfig = createServerFn({ method: "POST" })
  .inputValidator((data: { csrf: string }) => z.object({ csrf: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const admin = await adminGate(data.csrf);
    const { data: rows, error } = await admin.from("admin_config").select("key,value");
    if (error) throw new Error(error.message);
    const map: Record<string, string | number | boolean | null> = {};
    (rows ?? []).forEach((r: { key: string; value: unknown }) => { map[r.key] = toScalar(r.value); });
    return map;
  });

export const saveAdminConfig = createServerFn({ method: "POST" })
  .inputValidator((data: { csrf: string; entries: { key: string; value: unknown; is_public?: boolean }[] }) =>
    z.object({
      csrf: z.string().min(10),
      entries: z.array(
        z.object({
          key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
          value: z.unknown(),
          is_public: z.boolean().optional(),
        }),
      ).max(100),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const admin = await adminGate(data.csrf);
    for (const e of data.entries) {
      const { error } = await admin
        .from("admin_config")
        .upsert({ key: e.key, value: e.value as never, is_public: e.is_public ?? true }, { onConflict: "key" });
      if (error) throw new Error(error.message);
    }
    const m = await import("@/lib/admin-auth.server");
    await m.audit("admin.config.saved", null, { keys: data.entries.map((e) => e.key) });
    return { ok: true, saved: data.entries.length };
  });
