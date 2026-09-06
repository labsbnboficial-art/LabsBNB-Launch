// GET /api/public/rewards/:slug
// Public detail of one Creator Reward program: criteria, dates and counters.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/rewards/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = (params.slug ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ error: "Invalid program." }, { status: 400 });
        try {
          const engine = await import("@/lib/rewards/rewards-engine.server");
          const program = await engine.getProgramView(slug);
          if (!program) return Response.json({ error: "Program not found." }, { status: 404 });
          return Response.json(
            {
              slug: program.slug,
              name: program.name,
              description: program.description,
              status: program.status,
              startsAt: program.startsAt,
              endsAt: program.endsAt,
              seasonSlug: program.seasonSlug,
              seasonName: program.seasonName,
              evaluationWindow: program.evaluationWindow,
              evaluationStart: program.evaluationStart,
              evaluationEnd: program.evaluationEnd,
              ruleVersion: program.ruleVersion,
              criteria: program.rules.criteria,
              eligibleCreators: program.eligibleCreators,
              evaluatedCreators: program.evaluatedCreators,
              lastEvaluatedAt: program.lastEvaluatedAt,
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Rewards unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
