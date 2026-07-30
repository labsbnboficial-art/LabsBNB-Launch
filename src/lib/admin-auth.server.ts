// Server-only admin authentication core (username/password + PIN + optional TOTP).
// Replaces the previous SIWE/MetaMask wallet gate for /admin.
//
// Storage: `admin_accounts`, `admin_sessions`, `admin_audit_log`, `admin_login_attempts`
// (see docs/SQL_ADMIN_AUTH.md). All access goes through the service-role client.

import bcrypt from "bcryptjs";
import { sha256 } from "@noble/hashes/sha2";
import { hmac } from "@noble/hashes/hmac";
import { sha1 } from "@noble/hashes/sha1";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { getCookie, setCookie, deleteCookie, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

export const SESSION_COOKIE = "labsbnb_admin_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h absolute
export const IDLE_TTL_MS = 60 * 60 * 1000; // 1h idle
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

export type Stage = "password" | "totp" | "pin" | "full";

export type AdminAccount = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  pin_hash: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  failed_attempts: number;
  locked_until: string | null;
};

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

/* ---------------------------------- utils --------------------------------- */

export function hashToken(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

export function randomToken(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, BCRYPT_ROUNDS);
}

export async function verifySecret(value: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(value, hash);
  } catch {
    return false;
  }
}

export function clientIp(): string {
  return getRequestIP({ xForwardedFor: true }) || getRequestHeader("cf-connecting-ip") || "unknown";
}

export function userAgent(): string {
  return (getRequestHeader("user-agent") || "unknown").slice(0, 400);
}

function missingTables(message: string): boolean {
  return /relation .*admin_(accounts|sessions|audit_log|login_attempts).* does not exist|schema cache/i.test(message);
}

export class SetupRequiredError extends Error {}

/* --------------------------------- audit ---------------------------------- */

export async function audit(action: string, adminId: string | null, meta: Record<string, unknown> = {}) {
  try {
    const c = await db();
    await c.from("admin_audit_log").insert({
      admin_id: adminId,
      action,
      ip: clientIp(),
      user_agent: userAgent(),
      meta,
    });
  } catch {
    /* auditing must never break the request */
  }
}

/* ------------------------------ rate limiting ------------------------------ */
// Ad-hoc limiter (no platform primitive): failures are counted per identifier+IP
// within a rolling window, plus a hard account lock after MAX_FAILED failures.

export async function recentFailures(identifier: string): Promise<number> {
  const c = await db();
  const since = new Date(Date.now() - LOCK_MS).toISOString();
  const { count } = await c
    .from("admin_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("success", false)
    .or(`identifier.eq.${identifier.toLowerCase()},ip.eq.${clientIp()}`)
    .gte("created_at", since);
  return count ?? 0;
}

export async function recordAttempt(identifier: string, success: boolean) {
  try {
    const c = await db();
    await c.from("admin_login_attempts").insert({
      identifier: identifier.toLowerCase(),
      ip: clientIp(),
      success,
      user_agent: userAgent(),
    });
  } catch {
    /* ignore */
  }
}

/* -------------------------------- accounts -------------------------------- */

export async function accountCount(): Promise<number> {
  const c = await db();
  const { count, error } = await c.from("admin_accounts").select("id", { count: "exact", head: true });
  if (error) {
    if (missingTables(error.message)) throw new SetupRequiredError(error.message);
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function findAccount(identifier: string): Promise<AdminAccount | null> {
  const c = await db();
  const id = identifier.trim().toLowerCase();
  const { data, error } = await c
    .from("admin_accounts")
    .select("*")
    .or(`username.eq.${id},email.eq.${id}`)
    .maybeSingle();
  if (error && missingTables(error.message)) throw new SetupRequiredError(error.message);
  return (data as AdminAccount) ?? null;
}

export async function getAccount(id: string): Promise<AdminAccount | null> {
  const c = await db();
  const { data } = await c.from("admin_accounts").select("*").eq("id", id).maybeSingle();
  return (data as AdminAccount) ?? null;
}

export function isLocked(acc: AdminAccount): boolean {
  return !!acc.locked_until && new Date(acc.locked_until).getTime() > Date.now();
}

export async function noteFailure(acc: AdminAccount) {
  const c = await db();
  const attempts = (acc.failed_attempts ?? 0) + 1;
  await c
    .from("admin_accounts")
    .update({
      failed_attempts: attempts,
      locked_until: attempts >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : acc.locked_until,
    })
    .eq("id", acc.id);
}

export async function clearFailures(adminId: string) {
  const c = await db();
  await c.from("admin_accounts").update({ failed_attempts: 0, locked_until: null }).eq("id", adminId);
}

/* -------------------------------- sessions -------------------------------- */

export type SessionRow = {
  id: string;
  admin_id: string;
  csrf_token: string;
  stage: Stage;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export async function createSession(adminId: string, stage: Stage) {
  const c = await db();
  const token = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  const { error } = await c.from("admin_sessions").insert({
    admin_id: adminId,
    token_hash: hashToken(token),
    csrf_token: csrf,
    stage,
    ip: clientIp(),
    user_agent: userAgent(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    last_seen_at: new Date(now).toISOString(),
  });
  if (error) throw new Error(error.message);
  // The panel is often opened inside the Lovable preview iframe (cross-site),
  // where a `strict`/`lax` cookie is never sent back → the login looked stuck.
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return { csrf };
}

export async function currentSession(): Promise<{ session: SessionRow; account: AdminAccount } | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const c = await db();
  const { data } = await c.from("admin_sessions").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  const s = data as (SessionRow & { token_hash: string }) | null;
  if (!s || s.revoked_at) return null;
  const now = Date.now();
  if (new Date(s.expires_at).getTime() < now || now - new Date(s.last_seen_at).getTime() > IDLE_TTL_MS) {
    await c.from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", s.id);
    deleteCookie(SESSION_COOKIE, { path: "/", secure: true, sameSite: "none" });
    return null;
  }
  const account = await getAccount(s.admin_id);
  if (!account) return null;
  await c.from("admin_sessions").update({ last_seen_at: new Date(now).toISOString() }).eq("id", s.id);
  return { session: s, account };
}

export async function advanceStage(sessionId: string, stage: Stage) {
  const c = await db();
  await c.from("admin_sessions").update({ stage }).eq("id", sessionId);
}

export async function revokeCurrentSession() {
  const token = getCookie(SESSION_COOKIE);
  deleteCookie(SESSION_COOKIE, { path: "/", secure: true, sameSite: "none" });
  if (!token) return;
  const c = await db();
  await c.from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hashToken(token));
}

export async function revokeAllSessions(adminId: string) {
  const c = await db();
  await c
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("admin_id", adminId)
    .is("revoked_at", null);
  deleteCookie(SESSION_COOKIE, { path: "/", secure: true, sameSite: "none" });
}

/** Full authentication gate used by every privileged admin server function. */
export async function requireAdmin(csrf?: string) {
  const cur = await currentSession();
  if (!cur) throw new Error("Admin session expired. Sign in again.");
  if (cur.session.stage !== "full") throw new Error("Admin session incomplete. Finish the PIN step.");
  if (csrf !== undefined && csrf !== cur.session.csrf_token) throw new Error("Invalid CSRF token.");
  return cur;
}

/** Same gate, returning the service-role client for data access. */
export async function requireAdminClient(csrf?: string) {
  const cur = await requireAdmin(csrf);
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return { ...cur, client: adminClient };
}

/* ---------------------------------- TOTP ---------------------------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Uint8Array {
  const clean = secret.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const digest = hmac(sha1, key, buf);
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string): boolean {
  const counter = Math.floor(Date.now() / 30000);
  for (let w = -1; w <= 1; w++) {
    if (totpAt(secret, counter + w) === code) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string): string {
  return `otpauth://totp/LabsBNB%20Admin:${encodeURIComponent(account)}?secret=${secret}&issuer=LabsBNB&algorithm=SHA1&digits=6&period=30`;
}

/* -------------------------------- email ----------------------------------- */

/** Sends the password-reset email through Resend when RESEND_API_KEY is configured. */
export async function sendResetEmail(to: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_EMAIL_FROM || "LabsBNB <onboarding@resend.dev>";
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "LabsBNB — restablecer contraseña de admin",
      html: `<p>Recibimos una solicitud para restablecer la contraseña del panel de administración.</p>
             <p><a href="${link}">Restablecer contraseña</a></p>
             <p>El enlace caduca en 30 minutos. Si no fuiste tú, ignora este correo.</p>`,
    }),
  });
  return res.ok;
}
