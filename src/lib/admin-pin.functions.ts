import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function currentAdminWallet(): Promise<string> {
  const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const { data } = await supabaseAdmin.from("admin_config").select("value").eq("key", "admin_wallet").maybeSingle();
  return String(data?.value ?? "").replace(/^"|"$/g, "").toLowerCase();
}

async function callerWallet(userId: string): Promise<string> {
  const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
  const { data } = await supabaseAdmin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  return String(data?.wallet_address ?? "").toLowerCase();
}

async function hashPin(pin: string, adminWallet: string): Promise<string> {
  const { sha256 } = await import("@noble/hashes/sha2");
  const { bytesToHex } = await import("@noble/hashes/utils");
  return bytesToHex(sha256(new TextEncoder().encode(`labsbnb:${adminWallet}:${pin}`)));
}

export const setAdminPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pin: string }) => z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = await currentAdminWallet();
    const caller = await callerWallet(context.userId);
    if (!admin || caller !== admin) throw new Error("Only the admin wallet can set the PIN");
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const hash = await hashPin(data.pin, admin);
    const { error } = await supabaseAdmin.from("admin_config").upsert(
      { key: "admin_pin_hash", value: hash as unknown as never, is_public: false },
      { onConflict: "key" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const verifyAdminPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pin: string }) => z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = await currentAdminWallet();
    const caller = await callerWallet(context.userId);
    if (!admin || caller !== admin) throw new Error("Not admin wallet");
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const { data: row } = await supabaseAdmin.from("admin_config").select("value").eq("key", "admin_pin_hash").maybeSingle();
    const stored = row?.value ? String(row.value).replace(/^"|"$/g, "") : "";
    if (!stored) return { ok: false, notSet: true };
    const hash = await hashPin(data.pin, admin);
    return { ok: hash === stored };
  });

export const adminHasPin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await currentAdminWallet();
    const caller = await callerWallet(context.userId);
    if (!admin || caller !== admin) return { isAdminWallet: false, hasPin: false };
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const { data: row } = await supabaseAdmin.from("admin_config").select("value").eq("key", "admin_pin_hash").maybeSingle();
    const stored = row?.value ? String(row.value).replace(/^"|"$/g, "") : "";
    return { isAdminWallet: true, hasPin: stored.length > 0 };
  });
