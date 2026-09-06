// POST /api/public/creator-points/run — scheduled Creator Points Engine run.
// Protected by a shared secret (`POINTS_CRON_SECRET`, falling back to
// `TRENDING_CRON_SECRET` / `SIGNALS_CRON_SECRET`) sent as `x-points-secret`
// or `Authorization: Bearer`.
//
// The run is idempotent: repeated executions over the same data award points
// exactly once (sha256 fingerprint + UNIQUE constraint in the ledger).
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/creator-points/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret =
          process.env["POINTS_CRON_SECRET"] ||
          process.env["TRENDING_CRON_SECRET"] ||
          process.env["SIGNALS_CRON_SECRET"];
        if (!secret) return Response.json({ error: "Cron secret is not configured." }, { status: 503 });

        const header = request.headers.get("x-points-secret");
        const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const provided = header || bearer;
        if (!provided || !timingSafeEqual(provided, secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const engine = await import("@/lib/points/points-engine.server");
          const result = await engine.runCreatorPointsEngine("cron");
          return Response.json({
            ok: result.ok,
            skipped: result.skipped ?? null,
            state: result.state,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Creator Points Engine failure";
          console.error(`[CREATOR_POINTS] cron run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
