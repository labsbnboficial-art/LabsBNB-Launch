// GET /api/public/creator/:address/level-history
// Public, read-only milestone history of a creator. No admin data, no PII.
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";

export const Route = createFileRoute("/api/public/creator/$address/level-history")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const address = (params.address ?? "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        const creator = address.toLowerCase();
        try {
          const [levels, store, history] = await Promise.all([
            import("@/lib/levels/levels-config.server"),
            import("@/lib/points/points-store.server"),
            import("@/lib/levels/level-history.server"),
          ]);
          const [config, totals, entries] = await Promise.all([
            levels.loadLevelsConfig(),
            store.creatorTotals(ACTIVE_CHAIN_ID, creator),
            history.getCreatorLevelHistory(creator, ACTIVE_CHAIN_ID),
          ]);
          const { calculateCreatorLevel } = await import("@/lib/levels/levels-rules");
          return Response.json(
            {
              creator,
              chainId: ACTIVE_CHAIN_ID,
              currentLevel: config.enabled ? calculateCreatorLevel(totals.totalPoints, config).level : null,
              currentPoints: totals.totalPoints,
              history: entries.map((e) => ({
                previousLevel: e.previousLevel,
                newLevel: e.newLevel,
                pointsAtLevelUp: e.pointsAtLevelUp,
                createdAt: e.createdAt,
                milestoneKey: e.milestoneKey,
                source: e.source,
                backfill: e.backfill,
              })),
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Level history unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
