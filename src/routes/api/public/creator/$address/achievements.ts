// GET /api/public/creator/:address/achievements
// Public, read-only achievements of a creator. No admin data, no PII.
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";

export const Route = createFileRoute("/api/public/creator/$address/achievements")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const address = (params.address ?? "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        try {
          const { getCreatorAchievements } = await import("@/lib/achievements/achievement-engine.server");
          const summary = await getCreatorAchievements(address, ACTIVE_CHAIN_ID);
          return Response.json(
            {
              creator: summary.creator,
              chainId: summary.chainId,
              achievements: summary.achievements.map((a) => ({
                key: a.key,
                name: a.name,
                description: a.description,
                icon: a.icon,
                category: a.category,
                rarity: a.rarity,
                unlocked: a.unlocked,
                unlockedAt: a.unlockedAt,
                evidence: a.unlocked ? a.evidence : null,
                progress: a.progress,
                legacy: a.legacy,
              })),
              totalAchievements: summary.totalAchievements,
              unlockedAchievements: summary.unlockedAchievements,
              completionPercentage: summary.completionPercentage,
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Achievements unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
