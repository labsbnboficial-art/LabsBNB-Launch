import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Config reads/writes go through the server so they don't depend on the
 * `admin_config` RLS policy (which calls `has_role`, a function the anon role
 * cannot execute — that was the 401 "permission denied for function has_role").
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
  (data ?? []).forEach((r) => { map[r.key] = toScalar(r.value); });
  return map;
});

async function assertAdmin(userId: string) {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  const { data: cfg } = await adminClient.from("admin_config").select("value").eq("key", "admin_wallet").maybeSingle();
  const admin = String(cfg?.value ?? "").replace(/^"|"$/g, "").toLowerCase();
  const { data: prof } = await adminClient.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  const caller = String(prof?.wallet_address ?? "").toLowerCase();
  if (!admin || caller !== admin) throw new Error("Forbidden: not the admin wallet");
  return adminClient;
}

export const getAdminConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context.userId);
    const { data, error } = await admin.from("admin_config").select("key,value").neq("key", "admin_pin_hash");
    if (error) throw new Error(error.message);
    const map: Record<string, string | number | boolean | null> = {};
    (data ?? []).forEach((r) => { map[r.key] = toScalar(r.value); });
    return map;
  });

export const saveAdminConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { entries: { key: string; value: unknown; is_public?: boolean }[] }) =>
    z.object({
      entries: z.array(
        z.object({
          key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
          value: z.unknown(),
          is_public: z.boolean().optional(),
        }),
      ).max(100),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context.userId);
    for (const e of data.entries) {
      if (e.key === "admin_pin_hash") continue;
      const { error } = await admin
        .from("admin_config")
        .upsert({ key: e.key, value: e.value as never, is_public: e.is_public ?? true }, { onConflict: "key" });
      if (error) throw new Error(error.message);
    }
    return { ok: true, saved: data.entries.length };
  });
