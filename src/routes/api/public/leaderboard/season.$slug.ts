// GET /api/public/leaderboard/season/:slug
// Public standings of one Creator Season. Final seasons are immutable history.
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";

export const Route = createFileRoute("/api/public/leaderboard/season/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = (params.slug ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
          return Response.json({ error: "Invalid season slug." }, { status: 400 });
        }
        try {
          const engine = await import("@/lib/leaderboard/leaderboard-engine.server");
          const detail = await engine.getSeasonDetail(slug);
          if (!detail.season) return Response.json({ error: "Season not found." }, { status: 404 });
          return Response.json(
            { chainId: ACTIVE_CHAIN_ID, ...detail },
            { headers: { "cache-control": detail.final ? "public, max-age=300" : "public, max-age=30" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Season unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
