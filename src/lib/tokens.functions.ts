import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeSocialRecord, OPTIONAL_SOCIAL_KEYS, SOCIAL_FIELDS, type SocialKey } from "@/lib/social";

/**
 * Makes sure a token deployed on-chain has a row in `tokens`, so features that
 * reference it by id (comments, missions, ranking) work even when the original
 * save after deployment failed. Idempotent: returns the existing row id.
 */
export const ensureTokenRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { address: string; name: string; ticker: string; creator?: string | null }) =>
    z
      .object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        name: z.string().trim().min(1).max(64),
        ticker: z.string().trim().min(1).max(16),
        creator: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const address = data.address.toLowerCase();

    const { data: existing, error: findError } = await supabaseAdmin
      .from("tokens")
      .select("id")
      .ilike("contract_address", address)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existing) return { id: existing.id as string, created: false };

    const { data: row, error } = await supabaseAdmin
      .from("tokens")
      .insert({
        name: data.name,
        ticker: data.ticker,
        contract_address: address,
        chain_id: 97,
        creator_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string, created: true };
  });

/* -------------------------------------------------------------------------- */
/*  Full profile save right after a deployment                                 */
/* -------------------------------------------------------------------------- */

const optionalText = z.string().trim().max(500).optional().nullable();
const socialShape = Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, optionalText])) as Record<
  SocialKey,
  typeof optionalText
>;

/**
 * Persists the token profile (images, description and socials) with the service
 * role, so a missing/incorrect RLS policy on `tokens` can never make a freshly
 * deployed token lose its logo, banner and social links.
 */
export const saveTokenProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        name: z.string().trim().min(1).max(64),
        ticker: z.string().trim().min(1).max(16),
        description: z.string().trim().max(1000).optional().nullable(),
        logo_url: optionalText,
        banner_url: optionalText,
        category: z.string().trim().max(40).optional().nullable(),
        supply: z.number().optional().nullable(),
        decimals: z.number().int().min(0).max(18).optional().nullable(),
        chain_id: z.number().int().positive().optional().nullable(),
        deploy_tx_hash: z.string().trim().max(100).optional().nullable(),
        curve_address: z.string().trim().max(100).optional().nullable(),
        target_bnb: z.number().optional().nullable(),
        ...socialShape,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const address = data.address.toLowerCase();

    const socials = normalizeSocialRecord(
      Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, (data as Record<string, string | null>)[f.key]])) as Partial<
        Record<SocialKey, string | null>
      >,
    );

    const base: Record<string, unknown> = {
      name: data.name,
      ticker: data.ticker.toUpperCase(),
      description: data.description?.trim() || null,
      logo_url: data.logo_url?.trim() || null,
      banner_url: data.banner_url?.trim() || null,
      category: data.category || null,
      supply: data.supply ?? null,
      decimals: data.decimals ?? 18,
      chain_id: data.chain_id ?? 97,
      contract_address: address,
      deploy_tx_hash: data.deploy_tx_hash || null,
      status: "active",
      creator_id: context.userId,
      ...socials,
    };
    // Drop empty values so a retry never wipes previously stored data.
    const payload = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== null && v !== undefined));

    const { data: existing, error: findError } = await supabaseAdmin
      .from("tokens")
      .select("id, creator_id")
      .ilike("contract_address", address)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existing && existing.creator_id && existing.creator_id !== context.userId) {
      throw new Error("Solo el creador puede editar este token.");
    }

    const run = async (body: Record<string, unknown>) =>
      existing
        ? await supabaseAdmin.from("tokens").update(body as never).eq("id", existing.id).select("id").single()
        : await supabaseAdmin.from("tokens").insert(body as never).select("id").single();

    let { data: row, error } = await run(payload);
    // Optional columns (medium/youtube/instagram, category, supply…) may not
    // exist yet in older databases — retry without them instead of failing.
    if (error && /column .* does not exist|schema cache/i.test(error.message)) {
      const reduced = { ...payload };
      [...OPTIONAL_SOCIAL_KEYS, "category", "supply", "decimals", "deploy_tx_hash"].forEach((k) => delete reduced[k]);
      ({ data: row, error } = await run(reduced));
    }
    if (error) throw new Error(error.message);

    const tokenId = row!.id as string;

    if (data.curve_address || data.target_bnb) {
      await supabaseAdmin
        .from("bonding_curves")
        .insert({
          token_id: tokenId,
          ...(data.target_bnb ? { target_bnb: Math.floor(data.target_bnb * 1e18) } : {}),
          ...(data.curve_address ? { contract_address: data.curve_address.toLowerCase() } : {}),
        } as never)
        .then(() => undefined, () => undefined);
    }

    return { id: tokenId, created: !existing };
  });
