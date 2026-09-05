import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const notificationInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("one"), id: z.string().uuid() }),
  z.object({ mode: z.literal("all") }),
]);

type NotificationPayload = Record<string, unknown> & { read?: boolean };

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => notificationInput.parse(data))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("@/integrations/supabase/admin.server");
    let query = adminClient
      .from("activity")
      .select("id,payload")
      .eq("kind", "notification")
      .eq("user_id", context.userId);

    if (data.mode === "one") query = query.eq("id", data.id);

    const { data: rows, error: readError } = await query.limit(data.mode === "one" ? 1 : 100);
    if (readError) throw new Error("No se pudieron consultar las notificaciones.");

    const unread = (rows ?? []).filter((row) => {
      const payload = (row.payload ?? {}) as NotificationPayload;
      return payload.read !== true;
    });

    if (unread.length === 0) return { updated: 0 };

    const results = await Promise.all(
      unread.map((row) => {
        const payload = (row.payload ?? {}) as NotificationPayload;
        return adminClient
          .from("activity")
          .update({ payload: { ...payload, read: true } as never })
          .eq("id", row.id)
          .eq("user_id", context.userId);
      }),
    );
    const writeError = results.find((result) => result.error)?.error;
    if (writeError) throw new Error("No se pudieron marcar las notificaciones como leídas.");

    return { updated: unread.length };
  });