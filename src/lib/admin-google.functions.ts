import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TEMPORARY (testing) admin access via Google sign-in.
 * Any authenticated Google account listed in `admin_config.admin_google_emails`
 * (comma separated) is accepted; when the list is empty every signed-in user is
 * accepted so the panel can be exercised during testing.
 */
export const adminGoogleLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("@/lib/admin-auth.server");
    const { adminClient: typedClient } = await import("@/integrations/supabase/admin.server");
    const adminClient = typedClient as unknown as import("@supabase/supabase-js").SupabaseClient;

    const email = String(
      (context.claims as Record<string, unknown> | undefined)?.email ?? "",
    ).trim().toLowerCase();
    if (!email) throw new Error("Tu cuenta de Google no expone un correo.");

    const { data: allowRow } = await adminClient
      .from("admin_config")
      .select("value")
      .eq("key", "admin_google_emails")
      .maybeSingle();
    const raw = allowRow?.value;
    const allow = String(typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "")
      .replace(/^"|"$/g, "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allow.length > 0 && !allow.includes(email)) {
      await m.audit("admin.google.denied", null, { email });
      throw new Error("Esta cuenta de Google no está autorizada para el panel.");
    }

    let account = await m.findAccount(email);
    if (!account) {
      const { data, error } = await adminClient
        .from("admin_accounts")
        .insert({
          username: email.split("@")[0].slice(0, 32),
          email,
          password_hash: await m.hashSecret(m.randomToken(16)),
          pin_hash: null,
          totp_enabled: false,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      account = data as unknown as typeof account;
    }

    const { csrf } = await m.createSession(account!.id, "full");
    await m.audit("admin.google.login", account!.id, { email });
    return { ok: true, csrf, email };
  });
