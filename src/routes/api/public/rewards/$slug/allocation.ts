// GET /api/public/rewards/:slug/allocation
// Public allocation of one program — ONLY what the program publishes. Amounts
// are omitted unless a reward pool is configured. Nothing here distributes.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/rewards/$slug/allocation")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = (params.slug ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ error: "Invalid program." }, { status: 400 });
        try {
          const engine = await import("@/lib/rewards/allocation-engine.server");
          const allocation = await engine.getPublicAllocation(slug);
          return Response.json(
            {
              slug: allocation.slug,
              visible: allocation.visible,
              method: allocation.visible ? allocation.method : null,
              recipients: allocation.recipients,
              totalPct: allocation.totalPct,
              poolTotal: allocation.poolTotal,
              poolUnit: allocation.poolUnit,
              evaluatedAt: allocation.evaluatedAt,
              allocationVersion: allocation.allocationVersion,
              entries: allocation.entries,
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Allocation unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
