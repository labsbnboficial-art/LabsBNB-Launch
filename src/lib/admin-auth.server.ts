// Shared admin-wallet resolution for server functions.
// Falls back to the hardcoded launch admin wallet when `admin_config.admin_wallet`
// has not been seeded yet, and to the auth user metadata when the `profiles`
// row is missing — both were causes of the admin panel refusing access.

export const FALLBACK_ADMIN_WALLET = "0x60e655fe39bc7d17661f226bb44dcc681cc4e05e";

function clean(v: unknown): string {
  return String(v ?? "").replace(/^"|"$/g, "").trim().toLowerCase();
}

export async function currentAdminWallet(): Promise<string> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  try {
    const { data } = await adminClient
      .from("admin_config")
      .select("value")
      .eq("key", "admin_wallet")
      .maybeSingle();
    const w = clean(data?.value);
    if (/^0x[a-f0-9]{40}$/.test(w)) return w;
  } catch {
    /* fall through */
  }
  return FALLBACK_ADMIN_WALLET;
}

export async function callerWallet(userId: string): Promise<string> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  try {
    const { data } = await adminClient
      .from("profiles")
      .select("wallet_address")
      .eq("id", userId)
      .maybeSingle();
    const w = clean(data?.wallet_address);
    if (/^0x[a-f0-9]{40}$/.test(w)) return w;
  } catch {
    /* fall through */
  }
  // Fallback: wallet stored on the auth user (set by SIWE) or its wallet email.
  try {
    const { data } = await adminClient.auth.admin.getUserById(userId);
    const meta = clean((data?.user?.user_metadata as { wallet_address?: string } | undefined)?.wallet_address);
    if (/^0x[a-f0-9]{40}$/.test(meta)) return meta;
    const email = clean(data?.user?.email);
    const m = email.match(/^(0x[a-f0-9]{40})@wallet\.labsbnb$/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return "";
}

export async function assertAdmin(userId: string) {
  const admin = await currentAdminWallet();
  const caller = await callerWallet(userId);
  if (!caller) throw new Error("No wallet linked to this session. Sign in again with your wallet.");
  if (caller !== admin) throw new Error(`Forbidden: ${caller} is not the admin wallet (${admin}).`);
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient;
}
