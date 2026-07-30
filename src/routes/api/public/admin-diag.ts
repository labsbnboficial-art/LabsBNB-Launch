import { createFileRoute } from "@tanstack/react-router";

/** Temporary diagnostic: reports whether admin backend prerequisites are present. */
export const Route = createFileRoute("/api/public/admin-diag")({
  server: {
    handlers: {
      GET: async () => {
        const out: Record<string, unknown> = {
          hasServiceKey: !!(process.env.LABSBNB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
          hasUrl: !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
        };
        try {
          const { adminClient } = await import("@/integrations/supabase/admin.server");
          const c = adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
          const { count, error } = await c
            .from("admin_accounts")
            .select("id", { count: "exact", head: true });
          out.count = count;
          out.error = error?.message ?? null;
        } catch (e) {
          out.thrown = (e as Error).message;
        }
        return new Response(JSON.stringify(out), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
