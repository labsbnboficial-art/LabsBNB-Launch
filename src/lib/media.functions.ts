import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Token images are uploaded through the server (service role) so the browser
 * never depends on storage RLS. The bucket `token-media` is public, so the
 * returned URL is a permanent CDN URL — signed URLs used to expire and broke
 * every card that rendered them.
 */

export const uploadTokenMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["logo", "banner"]),
        contentType: z.string().min(3).max(60),
        // base64 payload without the data-URL prefix
        data: z.string().min(16).max(8_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const maxBytes = 4 * 1024 * 1024;
    const allowed: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = allowed[data.contentType.toLowerCase()];
    if (!ext) throw new Error("Formato no soportado. Usa PNG, JPG, WEBP o GIF.");

    const bytes = Buffer.from(data.data, "base64");
    if (!bytes.length) throw new Error("El archivo está vacío.");
    if (bytes.length > maxBytes) throw new Error("La imagen supera los 4 MB.");

    const { adminClient } = await import("@/integrations/supabase/admin.server");
    const path = `${context.userId}/${data.kind}-${Date.now()}.${ext}`;

    const { error } = await adminClient.storage
      .from("token-media")
      .upload(path, bytes, { contentType: data.contentType, upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(error.message);

    return { url: `/api/public/token-media?path=${encodeURIComponent(path)}` };
  });
