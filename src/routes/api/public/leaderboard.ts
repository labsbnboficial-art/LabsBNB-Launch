// GET /api/public/leaderboard?category=&page=&pageSize=
// Public, read-only creator ranking. No secrets, no PII, server-side validated.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/leaderboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const rules = await import("@/lib/leaderboard/leaderboard-rules");
          const engine = await import("@/lib/leaderboard/leaderboard-engine.server");
          const categoryRaw = (url.searchParams.get("category") ?? "overall").toLowerCase();
          if (!rules.isCategory(categoryRaw)) {
            return Response.json({ error: "Invalid category." }, { status: 400 });
          }
          const { page, pageSize } = rules.clampPagination(
            url.searchParams.get("page"),
            url.searchParams.get("pageSize"),
          );
          const result = await engine.getLeaderboardPage({ category: categoryRaw, page, pageSize });
          return Response.json(result, {
            headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Leaderboard unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
