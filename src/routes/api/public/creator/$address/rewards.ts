// GET /api/public/creator/:address/rewards
// Public rewards eligibility of one creator: status, eligibility score and the
// explicit PASS / FAIL / N/A breakdown of every criterion.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/creator/$address/rewards")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const address = (params.address ?? "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        try {
          const engine = await import("@/lib/rewards/rewards-engine.server");
          const summary = await engine.getCreatorRewards(address);
          return Response.json(
            {
              address: summary.address,
              chainId: summary.chainId,
              programs: summary.programs.map((p) => ({
                slug: p.slug,
                name: p.name,
                status: p.status,
                seasonName: p.seasonName,
                endsAt: p.endsAt,
                ruleVersion: p.ruleVersion,
                snapshotAt: p.snapshotAt,
                eligibility: p.evaluation.status,
                eligibilityScore: p.evaluation.eligibilityScore,
                criteria: p.evaluation.criteria,
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
