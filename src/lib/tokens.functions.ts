import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
