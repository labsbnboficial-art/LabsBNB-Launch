import type { SupabaseClient } from "@supabase/supabase-js";

export function configValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/**
 * `admin_config.updated_by` has a FK to `auth.users(id)`, but the admin panel
 * identity lives in `public.admin_accounts` (user/pass + PIN). Those UUIDs do
 * NOT exist in `auth.users`, so writing them raises
 * `admin_config_updated_by_fkey`. Attribution of admin changes is handled by
 * `admin_audit_log` (the mechanism already used across the admin panel), so we
 * only persist `updated_by` when the id really is an auth user.
 */
export async function configUpdatedBy(adminId: string | null): Promise<string | null> {
  if (!adminId) return null;
  try {
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const { data, error } = await adminClient.auth.admin.getUserById(adminId);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export async function requireConfigAdmin(csrf: string): Promise<{
  client: SupabaseClient;
  adminId: string;
}> {
  const auth = await import("@/lib/admin-auth.server");
  const current = await auth.requireAdmin(csrf);
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return { client: adminClient as unknown as SupabaseClient, adminId: current.account.id };
}