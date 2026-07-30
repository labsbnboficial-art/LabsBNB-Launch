import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const optionalUrl = z.string().trim().max(300).optional().nullable();

/**
 * Updates the public profile of a token (description + social links).
 * Only the creator recorded in `tokens.creator_id` can perform the change.
 */
export const updateTokenMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tokenId: z.string().uuid(),
        description: z.string().trim().max(1000).optional().nullable(),
        logo_url: optionalUrl,
        banner_url: optionalUrl,
        website: optionalUrl,
        twitter: optionalUrl,
        telegram: optionalUrl,
        discord: optionalUrl,
        github: optionalUrl,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tokenId, ...fields } = data;

    const { data: row, error: findError } = await supabaseAdmin
      .from("tokens")
      .select("id, creator_id")
      .eq("id", tokenId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!row) throw new Error("Token no encontrado.");
    if (row.creator_id !== context.userId) throw new Error("Solo el creador puede editar este token.");

    const patch: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(fields)) {
      patch[k] = v == null || v === "" ? null : String(v);
    }

    const { error } = await supabaseAdmin.from("tokens").update(patch).eq("id", tokenId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
