// GET /api/public/creator/:address/leaderboard
// Public leaderboard position of one creator (rank, change, best/worst, season).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/creator/$address/leaderboard")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const address = (params.address ?? "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        try {
          const engine = await import("@/lib/leaderboard/leaderboard-engine.server");
          const summary = await engine.getCreatorLeaderboardSummary(address);
          return Response.json(summary, { headers: { "cache-control": "public, max-age=60" } });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Leaderboard unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
