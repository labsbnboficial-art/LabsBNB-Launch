// AI Agent Co-Founder configuration per token.
// Stored in the existing `admin_config` key/value table under
// `ai_cofounder:<tokenAddress>` so no new table is required.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_COFOUNDER_PERSONALITIES, type AiCofounderConfig } from "./ai-cofounder";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const key = (address: string) => `ai_cofounder:${address.toLowerCase()}`;

export const saveAiCofounder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        address: addressSchema,
        enabled: z.boolean(),
        personality: z.enum(AI_COFOUNDER_PERSONALITIES),
        lore: z.string().trim().max(1500).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const address = data.address.toLowerCase();
    const { data: token, error: findError } = await adminClient
      .from("tokens")
      .select("id, creator_id")
      .eq("address", address)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!token) throw new Error("Token no encontrado.");
    if (token.creator_id && token.creator_id !== context.userId) {
      throw new Error("Solo el creador puede configurar el AI Co-Founder.");
    }
    const value: AiCofounderConfig = {
      enabled: data.enabled,
      personality: data.personality,
      lore: data.lore,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await adminClient
      .from("admin_config")
      .upsert({ key: key(address), value: value as never, is_public: true } as never, { onConflict: "key" });
    if (error) throw new Error(`No se pudo guardar el AI Co-Founder: ${error.message}`);
    return value;
  });

export const getAiCofounder = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => z.object({ address: addressSchema }).parse(d))
  .handler(async ({ data }): Promise<AiCofounderConfig | null> => {
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const { data: row } = await adminClient.from("admin_config").select("value").eq("key", key(data.address)).maybeSingle();
    const v = (row as { value?: unknown } | null)?.value;
    if (!v) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as AiCofounderConfig;
  });
