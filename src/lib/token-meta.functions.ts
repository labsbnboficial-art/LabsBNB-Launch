import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeSocialRecord, OPTIONAL_SOCIAL_KEYS, SOCIAL_FIELDS, type SocialKey } from "@/lib/social";

/**
 * Updates the public profile of a token (description, images and socials).
 * Only the creator recorded in `tokens.creator_id` can perform the change.
 */
export const updateTokenMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const optionalUrl = z.string().trim().max(500).optional().nullable();
    const socialShape = Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, optionalUrl])) as Record<SocialKey, typeof optionalUrl>;
    return z
      .object({
        tokenId: z.string().uuid(),
        description: z.string().trim().max(1000).optional().nullable(),
        logo_url: optionalUrl,
        banner_url: optionalUrl,
        ...socialShape,
      })
      .parse(d);
  })
  .handler(async ({ data, context }) => {
    const { adminClient: supabaseAdmin } = await import("@/integrations/supabase/admin.server");
    const { tokenId, description, logo_url, banner_url, ...socials } = data;

    const { data: row, error: findError } = await supabaseAdmin
      .from("tokens")
      .select("id, creator_id")
      .eq("id", tokenId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!row) throw new Error("Token no encontrado.");
    // Rows created by the on-chain fallback can have no owner yet: the first
    // authenticated editor claims it instead of hitting a permission error.
    if (row.creator_id && row.creator_id !== context.userId) {
      throw new Error("Solo el creador puede editar este token.");
    }

    const patch: Record<string, string | null> = {
      description: description?.trim() || null,
      logo_url: logo_url?.trim() || null,
      banner_url: banner_url?.trim() || null,
      ...normalizeSocialRecord(socials as Partial<Record<SocialKey, string | null>>),
    };
    if (!row.creator_id) patch.creator_id = context.userId;

    const write = async (body: Record<string, string | null>) =>
      supabaseAdmin.from("tokens").update(body as never).eq("id", tokenId).select("id").single();

    let body = { ...patch };
    let { error } = await write(body);
    // Some columns are optional (added by later migrations); retry without the
    // ones the database complains about instead of losing the whole update.
    let attempts = 0;
    while (error && /column .* does not exist|schema cache/i.test(error.message) && attempts < 6) {
      attempts += 1;
      const missing = error.message.match(/'([a-z0-9_]+)' column|column "?([a-z0-9_]+)"?/i);
      const key = missing?.[1] ?? missing?.[2];
      const next = { ...body };
      if (key && key in next) delete next[key];
      else OPTIONAL_SOCIAL_KEYS.forEach((k) => delete next[k]);
      if (Object.keys(next).length === Object.keys(body).length) break;
      body = next;
      ({ error } = await write(body));
    }

    if (error) throw new Error(`No se pudo actualizar la información del token: ${error.message}`);
    return { ok: true };

  });
