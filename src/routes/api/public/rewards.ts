// GET /api/public/rewards
// Public, read-only list of Creator Reward programs. No PII, no exclusion
// lists, no secrets. This endpoint never distributes anything.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/rewards")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const engine = await import("@/lib/rewards/rewards-engine.server");
          const result = await engine.listPublicPrograms();
          return Response.json(
            {
              chainId: result.chainId,
              storageReady: result.storageReady,
              programs: result.programs.map((p) => ({
                slug: p.slug,
                name: p.name,
                description: p.description,
                status: p.status,
                startsAt: p.startsAt,
                endsAt: p.endsAt,
                seasonSlug: p.seasonSlug,
                seasonName: p.seasonName,
                evaluationWindow: p.evaluationWindow,
                ruleVersion: p.ruleVersion,
                criteria: p.rules.criteria,
                eligibleCreators: p.eligibleCreators,
                evaluatedCreators: p.evaluatedCreators,
                lastEvaluatedAt: p.lastEvaluatedAt,
              })),
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
