import type { SupabaseClient } from "@supabase/supabase-js";

export function configValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
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