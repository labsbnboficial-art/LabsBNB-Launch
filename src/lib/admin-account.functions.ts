import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Admin panel authentication (username/email + password, mandatory 6-digit PIN,
 * optional TOTP two-factor). No wallet / SIWE involved.
 */

const pinRe = /^\d{6}$/;

async function core() {
  return import("@/lib/admin-auth.server");
}

export const adminAuthStatus = createServerFn({ method: "GET" }).handler(async () => {
  const m = await core();
  const base = {
    setupRequired: false as boolean,
    needsBootstrap: true,
    stage: null as string | null,
    csrf: null as string | null,
    username: null as string | null,
    email: null as string | null,
    totpEnabled: false,
    emailConfigured: !!process.env.RESEND_API_KEY,
    backendError: null as string | null,
    cookiePresent: false,
    sessionError: null as string | null,
  };
  base.cookiePresent = m.hasSessionCookie();
  try {
    const count = await m.accountCount();
    let cur: Awaited<ReturnType<typeof m.currentSession>> = null;
    let sessionError: string | null = null;
    try {
      cur = await m.currentSession();
    } catch (e) {
      // Session lookup can fail on its own (RLS / missing grants): report it
      // instead of silently rendering the login form again.
      sessionError = (e as Error).message;
    }
    return {
      ...base,
      needsBootstrap: count === 0,
      stage: cur?.session.stage ?? null,
      csrf: cur?.session.csrf_token ?? null,
      username: cur?.account.username ?? null,
      email: cur?.account.email ?? null,
      totpEnabled: cur?.account.totp_enabled ?? false,
      sessionError,
    };
  } catch (e) {
    if (e instanceof m.SetupRequiredError) {
      return { ...base, setupRequired: true };
    }
    // Never hard-fail the panel: report the cause so the operator can fix it.
    return { ...base, backendError: (e as Error).message || "Credenciales de servicio inválidas (LABSBNB_SERVICE_ROLE_KEY)." };
  }
});



/** First-run: creates the single admin account when none exists. */
export const adminBootstrap = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; email: string; password: string; pin: string }) =>
    z
      .object({
        username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
        email: z.string().trim().email().max(255),
        password: z.string().min(10).max(128),
        pin: z.string().regex(pinRe),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    if ((await m.accountCount()) > 0) throw new Error("Admin account already exists.");
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const { data: row, error } = await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_accounts")
      .insert({
        username: data.username.toLowerCase(),
        email: data.email.toLowerCase(),
        password_hash: await m.hashSecret(data.password),
        pin_hash: await m.hashSecret(data.pin),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await m.audit("admin.bootstrap", row.id, { username: data.username });
    const { csrf } = await m.createSession(row.id, "password");
    return { ok: true, csrf };
  });

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { identifier: string; password: string }) =>
    z.object({ identifier: z.string().trim().min(3).max(255), password: z.string().min(1).max(128) }).parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    if ((await m.recentFailures(data.identifier)) >= m.MAX_FAILED) {
      await m.audit("admin.login.rate_limited", null, { identifier: data.identifier });
      throw new Error("Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.");
    }
    const acc = await m.findAccount(data.identifier);
    if (!acc) {
      await m.recordAttempt(data.identifier, false);
      throw new Error("Credenciales incorrectas.");
    }
    if (m.isLocked(acc)) throw new Error("Cuenta bloqueada temporalmente por intentos fallidos.");
    const ok = await m.verifySecret(data.password, acc.password_hash);
    if (!ok) {
      await m.recordAttempt(data.identifier, false);
      await m.noteFailure(acc);
      await m.audit("admin.login.failed", acc.id, {});
      throw new Error("Credenciales incorrectas.");
    }
    await m.recordAttempt(data.identifier, true);
    await m.clearFailures(acc.id);
    const stage = acc.totp_enabled ? "totp" : "password";
    const { csrf } = await m.createSession(acc.id, stage);
    await m.audit("admin.login.password_ok", acc.id, { totp: acc.totp_enabled });
    return { ok: true, stage, csrf };
  });

export const adminVerifyTotpStep = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => z.object({ code: z.string().regex(pinRe) }).parse(d))
  .handler(async ({ data }) => {
    const m = await core();
    const cur = await m.currentSession();
    if (!cur || cur.session.stage !== "totp") throw new Error("Sesión inválida.");
    if (!cur.account.totp_secret || !m.verifyTotp(cur.account.totp_secret, data.code)) {
      await m.noteFailure(cur.account);
      await m.audit("admin.login.totp_failed", cur.account.id, {});
      throw new Error("Código 2FA incorrecto.");
    }
    await m.advanceStage(cur.session.id, "password");
    await m.audit("admin.login.totp_ok", cur.account.id, {});
    return { ok: true, stage: "password" as const };
  });

export const adminVerifyPinStep = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string }) => z.object({ pin: z.string().regex(pinRe) }).parse(d))
  .handler(async ({ data }) => {
    const m = await core();
    const cur = await m.currentSession();
    if (!cur || cur.session.stage !== "password") throw new Error("Sesión inválida.");
    if (!(await m.verifySecret(data.pin, cur.account.pin_hash))) {
      await m.noteFailure(cur.account);
      await m.audit("admin.login.pin_failed", cur.account.id, {});
      throw new Error("PIN incorrecto.");
    }
    await m.clearFailures(cur.account.id);
    await m.advanceStage(cur.session.id, "full");
    await m.audit("admin.login.success", cur.account.id, {});
    return { ok: true, stage: "full" as const, csrf: cur.session.csrf_token };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const m = await core();
  const cur = await m.currentSession();
  if (cur) await m.audit("admin.logout", cur.account.id, {});
  await m.revokeCurrentSession();
  return { ok: true };
});

/* ------------------------------ account mgmt ------------------------------ */

export const adminUpdateCredentials = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      csrf: string;
      currentPassword: string;
      username?: string;
      email?: string;
      newPassword?: string;
      newPin?: string;
    }) =>
      z
        .object({
          csrf: z.string().min(10),
          currentPassword: z.string().min(1).max(128),
          username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
          email: z.string().trim().email().max(255).optional(),
          newPassword: z.string().min(10).max(128).optional(),
          newPin: z.string().regex(pinRe).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    const cur = await m.requireAdmin(data.csrf);
    if (!(await m.verifySecret(data.currentPassword, cur.account.password_hash)))
      throw new Error("La contraseña actual no es correcta.");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.username) patch.username = data.username.toLowerCase();
    if (data.email) patch.email = data.email.toLowerCase();
    if (data.newPassword) patch.password_hash = await m.hashSecret(data.newPassword);
    if (data.newPin) patch.pin_hash = await m.hashSecret(data.newPin);
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const { error } = await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_accounts")
      .update(patch)
      .eq("id", cur.account.id);
    if (error) throw new Error(error.message);
    await m.audit("admin.credentials.updated", cur.account.id, {
      username: !!data.username,
      email: !!data.email,
      password: !!data.newPassword,
      pin: !!data.newPin,
    });
    if (data.newPassword) await m.revokeAllSessions(cur.account.id);
    return { ok: true, signedOut: !!data.newPassword };
  });

export const adminStartTotp = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => z.object({ csrf: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const m = await core();
    const cur = await m.requireAdmin(data.csrf);
    const secret = m.generateTotpSecret();
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_accounts")
      .update({ totp_secret: secret })
      .eq("id", cur.account.id);
    return { secret, uri: m.otpauthUri(secret, cur.account.email) };
  });

export const adminSetTotpEnabled = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; enabled: boolean; code: string }) =>
    z.object({ csrf: z.string().min(10), enabled: z.boolean(), code: z.string().regex(pinRe) }).parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    const cur = await m.requireAdmin(data.csrf);
    if (!cur.account.totp_secret) throw new Error("Genera primero el secreto 2FA.");
    if (!m.verifyTotp(cur.account.totp_secret, data.code)) throw new Error("Código 2FA incorrecto.");
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_accounts")
      .update({ totp_enabled: data.enabled, totp_secret: data.enabled ? cur.account.totp_secret : null })
      .eq("id", cur.account.id);
    await m.audit(data.enabled ? "admin.2fa.enabled" : "admin.2fa.disabled", cur.account.id, {});
    return { ok: true, enabled: data.enabled };
  });

/* --------------------------- password recovery ---------------------------- */

export const adminRequestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => z.object({ email: z.string().trim().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    const m = await core();
    const acc = await m.findAccount(data.email);
    // Always answer the same thing (no account enumeration).
    if (!acc) return { ok: true, delivered: false };
    const token = m.randomToken(24);
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_accounts")
      .update({
        reset_token_hash: m.hashToken(token),
        reset_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .eq("id", acc.id);
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    const origin = getRequestUrl().origin;
    const link = `${origin}/admin?reset=${token}`;
    const delivered = await m.sendResetEmail(acc.email, link);
    await m.audit("admin.password_reset.requested", acc.id, { delivered });
    return { ok: true, delivered };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; password: string; pin: string }) =>
    z
      .object({ token: z.string().min(20).max(200), password: z.string().min(10).max(128), pin: z.string().regex(pinRe) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const c = adminClient as never as import("@supabase/supabase-js").SupabaseClient;
    const { data: acc } = await c
      .from("admin_accounts")
      .select("id, reset_expires_at")
      .eq("reset_token_hash", m.hashToken(data.token))
      .maybeSingle();
    if (!acc || !acc.reset_expires_at || new Date(acc.reset_expires_at).getTime() < Date.now())
      throw new Error("El enlace de recuperación no es válido o ha caducado.");
    await c
      .from("admin_accounts")
      .update({
        password_hash: await m.hashSecret(data.password),
        pin_hash: await m.hashSecret(data.pin),
        reset_token_hash: null,
        reset_expires_at: null,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq("id", acc.id);
    await m.revokeAllSessions(acc.id);
    await m.audit("admin.password_reset.completed", acc.id, {});
    return { ok: true };
  });

/* --------------------------------- audit ---------------------------------- */

export const adminAuditLog = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => z.object({ csrf: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const m = await core();
    await m.requireAdmin(data.csrf);
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const { data: rows, error } = await (adminClient as never as import("@supabase/supabase-js").SupabaseClient)
      .from("admin_audit_log")
      .select("id, action, ip, user_agent, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      action: String(r.action),
      ip: r.ip ? String(r.ip) : "",
      user_agent: r.user_agent ? String(r.user_agent) : "",
      meta: r.meta ? JSON.stringify(r.meta) : "",
      created_at: String(r.created_at),
    }));
  });

/* --------------------- provisioning / recovery by key ---------------------- */

/**
 * Creates a new admin account (or resets an existing one) without needing an
 * active session. Used when the operator is locked out of the panel.
 * Authorised by the ADMIN_SETUP_KEY secret, which only the project owner knows.
 */
export const adminProvision = createServerFn({ method: "POST" })
  .inputValidator((d: { setupKey: string; username: string; email: string; password: string; pin: string }) =>
    z
      .object({
        setupKey: z.string().min(8).max(200),
        username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
        email: z.string().trim().email().max(255),
        password: z.string().min(10).max(128),
        pin: z.string().regex(pinRe),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await core();
    const expected = process.env.ADMIN_SETUP_KEY;
    if (!expected) throw new Error("Falta el secreto ADMIN_SETUP_KEY en el servidor.");
    // Constant-time comparison over the hashes so length/prefix don't leak.
    if (m.hashToken(data.setupKey) !== m.hashToken(expected)) {
      await m.audit("admin.provision.denied", null, { username: data.username });
      throw new Error("Clave maestra incorrecta.");
    }

    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const c = adminClient as never as import("@supabase/supabase-js").SupabaseClient;
    const username = data.username.toLowerCase();
    const email = data.email.toLowerCase();

    const credentials = {
      username,
      email,
      password_hash: await m.hashSecret(data.password),
      pin_hash: await m.hashSecret(data.pin),
      failed_attempts: 0,
      locked_until: null as string | null,
      reset_token_hash: null as string | null,
      reset_expires_at: null as string | null,
    };

    const { data: existing } = await c
      .from("admin_accounts")
      .select("id")
      .or(`username.eq.${username},email.eq.${email}`)
      .maybeSingle();

    if (existing) {
      const { error } = await c.from("admin_accounts").update(credentials).eq("id", existing.id);
      if (error) throw new Error(error.message);
      await m.revokeAllSessions(existing.id as string);
      await m.audit("admin.provision.reset", existing.id as string, { username });
      return { ok: true, created: false };
    }

    const { data: row, error } = await c.from("admin_accounts").insert(credentials).select("id").single();
    if (error) throw new Error(error.message);
    await m.audit("admin.provision.created", row.id as string, { username });
    return { ok: true, created: true };
  });
