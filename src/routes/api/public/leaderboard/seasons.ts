// GET /api/public/leaderboard/seasons
// Public list of Creator Seasons (past, active and scheduled) with top 3.
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";

export const Route = createFileRoute("/api/public/leaderboard/seasons")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const engine = await import("@/lib/leaderboard/leaderboard-engine.server");
          const seasons = await engine.listSeasonSummaries();
          return Response.json(
            { chainId: ACTIVE_CHAIN_ID, seasons },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Seasons unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
