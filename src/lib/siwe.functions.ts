import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * SIWE-style wallet authentication.
 *
 * 1) Client calls `siweChallenge({ address })` → gets a nonce + message to sign.
 * 2) User signs the message with their wallet.
 * 3) Client calls `siweVerify({ address, message, signature })` → server verifies,
 *    ensures a Supabase user exists for this wallet, returns `{ email, token_hash }`.
 * 4) Client completes with `supabase.auth.verifyOtp({ email, token_hash, type: 'magiclink' })`.
 */

const ADDR = /^0x[a-fA-F0-9]{40}$/;

function walletEmail(addr: string): string {
  return `${addr.toLowerCase()}@wallet.labsbnb`;
}

function buildMessage(domain: string, address: string, nonce: string, issuedAt: string, chainId: number) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    ``,
    `Sign in to LabsBNB Launchpad. This request will not trigger a blockchain transaction or cost any gas fees.`,
    ``,
    `URI: https://${domain}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export const siweChallenge = createServerFn({ method: "POST" })
  .inputValidator((data: { address: string; domain?: string; chainId?: number }) =>
    z.object({
      address: z.string().regex(ADDR),
      domain: z.string().min(1).max(256).optional(),
      chainId: z.number().int().positive().optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const issuedAt = new Date().toISOString();
    const domain = data.domain || "labsbnb.app";
    const chainId = data.chainId ?? 97;
    const message = buildMessage(domain, data.address, nonce, issuedAt, chainId);
    return { message, nonce, issuedAt };
  });

export const siweVerify = createServerFn({ method: "POST" })
  .inputValidator((data: { address: string; message: string; signature: string }) =>
    z.object({
      address: z.string().regex(ADDR),
      message: z.string().min(1).max(4000),
      signature: z.string().min(1).max(500),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { verifyMessage } = await import("viem");
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");

    // Signature check
    const valid = await verifyMessage({
      address: data.address as `0x${string}`,
      message: data.message,
      signature: data.signature as `0x${string}`,
    });
    if (!valid) throw new Error("Invalid signature");

    // Freshness: `Issued At` line must be within 10 minutes
    const m = data.message.match(/Issued At:\s*(\S+)/);
    if (!m) throw new Error("Malformed message");
    const issuedMs = Date.parse(m[1]);
    if (!Number.isFinite(issuedMs)) throw new Error("Malformed timestamp");
    if (Math.abs(Date.now() - issuedMs) > 10 * 60_000) throw new Error("Message expired, please retry");

    const email = walletEmail(data.address);

    // Resolve by wallet profile first. Unlike listUsers(page 1), this remains
    // deterministic after the project grows beyond 200 users.
    const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("wallet_address", data.address.toLowerCase())
      .maybeSingle();
    if (profileLookupError) throw new Error(`No se pudo consultar el perfil: ${profileLookupError.message}`);

    let user = null;
    if (existingProfile?.id) {
      const existingUser = await supabaseAdmin.auth.admin.getUserById(existingProfile.id);
      if (existingUser.error) throw new Error(`No se pudo recuperar el usuario: ${existingUser.error.message}`);
      user = existingUser.data.user;
    }
    if (!user) {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { wallet_address: data.address.toLowerCase(), auth_method: "siwe" },
      });
      if (created.error) throw created.error;
      user = created.data.user!;
    }

    // Upsert profile with wallet
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: user.id,
      wallet_address: data.address.toLowerCase(),
      username: `wallet_${data.address.slice(2, 8).toLowerCase()}`,
    }, { onConflict: "id" });
    if (profileError) throw new Error(`No se pudo crear el perfil: ${profileError.message}`);

    // If this wallet is the admin wallet, ensure admin role
    const { data: adminCfg } = await supabaseAdmin
      .from("admin_config").select("value").eq("key", "admin_wallet").maybeSingle();
    const adminWallet = String(adminCfg?.value ?? "").replace(/^"|"$/g, "").toLowerCase();
    if (adminWallet && adminWallet === data.address.toLowerCase()) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: user.id, role: "admin" },
        { onConflict: "user_id,role" },
      );
    }

    // Mint a magic-link token for the client to consume
    const link = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (link.error) throw link.error;
    const token_hash = link.data.properties?.hashed_token;
    if (!token_hash) throw new Error("Could not mint session token");

    return { email, token_hash };
  });
