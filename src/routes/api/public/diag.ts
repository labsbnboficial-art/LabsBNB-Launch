import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/diag")({
  server: {
    handlers: {
      GET: async () => {
        let adminOk = false;
        let adminErr = "";
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("admin_config").select("key").limit(1);
          adminOk = !error;
          adminErr = error?.message ?? "";
        } catch (e) {
          adminErr = (e as Error).message;
        }
        return Response.json({
          hasUrl: !!process.env.SUPABASE_URL,
          hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          adminOk,
          adminErr,
        });
      },
    },
  },
});
