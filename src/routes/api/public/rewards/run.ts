// POST /api/public/rewards/run — scheduled Eligibility Engine run (§33).
// Protected by the SAME shared-secret infrastructure already used by the other
// engines (`REWARDS_CRON_SECRET`, falling back to `POINTS_CRON_SECRET` /
// `TRENDING_CRON_SECRET` / `SIGNALS_CRON_SECRET`).
//
// The run is idempotent: repeated executions over the same window produce
// exactly one snapshot per creator (sha256 fingerprint + UNIQUE index).
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/rewards/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret =
          process.env["REWARDS_CRON_SECRET"] ||
          process.env["POINTS_CRON_SECRET"] ||
          process.env["TRENDING_CRON_SECRET"] ||
          process.env["SIGNALS_CRON_SECRET"];
        if (!secret) return Response.json({ error: "Cron secret is not configured." }, { status: 503 });

        const header = request.headers.get("x-rewards-secret") || request.headers.get("x-points-secret");
        const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const provided = header || bearer;
        if (!provided || !timingSafeEqual(provided, secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const engine = await import("@/lib/rewards/rewards-engine.server");
          const result = await engine.runRewardsEngine("cron");
          return Response.json({ ok: !result.state.errors, skipped: result.skippedReason, state: result.state });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Eligibility Engine failure";
          console.error(`[CREATOR_REWARDS] cron run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
