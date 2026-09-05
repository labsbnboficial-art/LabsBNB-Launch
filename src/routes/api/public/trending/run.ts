// POST /api/public/trending/run — scheduled Trending Engine execution.
// Protected by a shared secret (`TRENDING_CRON_SECRET`, falling back to
// `SIGNALS_CRON_SECRET`) sent as `x-trending-secret` or `Authorization: Bearer`.
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/trending/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["TRENDING_CRON_SECRET"] || process.env["SIGNALS_CRON_SECRET"];
        if (!secret) {
          return Response.json({ error: "Cron secret is not configured." }, { status: 503 });
        }
        const header = request.headers.get("x-trending-secret");
        const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const provided = header || bearer;
        if (!provided || !timingSafeEqual(provided, secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const engine = await import("@/lib/trending/trending-engine.server");
          const result = await engine.runTrendingEngine("cron");
          return Response.json({
            ok: result.ok,
            skipped: result.skipped ?? null,
            ranked: result.rows.length,
            state: result.state,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Trending Engine failure";
          console.error(`[TRENDING_ENGINE] cron run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
