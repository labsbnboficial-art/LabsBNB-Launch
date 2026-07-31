import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/token-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path")?.trim() ?? "";
        if (!/^[0-9a-f-]{36}\/(logo|banner)-\d+\.(png|jpe?g|webp|gif)$/i.test(path)) {
          return new Response("Invalid media path", { status: 400 });
        }
        const { adminClient } = await import("@/integrations/supabase/admin.server");
        const { data, error } = await adminClient.storage.from("token-media").download(path);
        if (error || !data) return new Response("Media not found", { status: 404 });
        return new Response(data, {
          headers: {
            "content-type": data.type || "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});