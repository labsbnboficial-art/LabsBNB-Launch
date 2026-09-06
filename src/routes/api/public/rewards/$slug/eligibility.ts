// GET /api/public/rewards/:slug/eligibility?filter=&page=&pageSize=
// Public eligibility table of one program. Server-side validated, paginated,
// cached. Nothing here is a promise of tokens or money.
import { createFileRoute } from "@tanstack/react-router";

const STATUSES = new Set(["all", "eligible", "not_eligible", "pending", "excluded"]);

export const Route = createFileRoute("/api/public/rewards/$slug/eligibility")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const slug = (params.slug ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ error: "Invalid program." }, { status: 400 });
        const url = new URL(request.url);
        const filter = (url.searchParams.get("filter") ?? "all").toLowerCase();
        if (!STATUSES.has(filter)) return Response.json({ error: "Invalid filter." }, { status: 400 });
        try {
          const rules = await import("@/lib/rewards/rewards-rules");
          const engine = await import("@/lib/rewards/rewards-engine.server");
          const { page, pageSize } = rules.clampPagination(url.searchParams.get("page") ?? undefined, url.searchParams.get("pageSize") ?? undefined);
          const result = await engine.getEligibilityPage({
            slug,
            filter: filter as "all",
            page,
            pageSize,
          });
          if (!result.program) return Response.json({ error: "Program not found." }, { status: 404 });
          return Response.json(
            {
              program: { slug: result.program.slug, name: result.program.name, status: result.program.status },
              counts: result.counts,
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              filter: result.filter,
              entries: result.entries.map((e) => ({
                rank: e.rank,
                address: e.address,
                displayName: e.displayName,
                status: e.status,
                eligibilityScore: e.eligibilityScore,
                points: e.metrics.points,
                score: e.metrics.score,
                level: e.metrics.level,
                achievements: e.metrics.achievements,
                graduations: e.metrics.graduations,
                organic: e.metrics.organic,
              })),
            },
            { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Eligibility unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
