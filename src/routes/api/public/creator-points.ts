// GET /api/public/creator-points?address=0x...&limit=&offset=
// Public, read-only balance + history of a creator. No secrets, no PII.
import { createFileRoute } from "@tanstack/react-router";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";

export const Route = createFileRoute("/api/public/creator-points")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const address = (url.searchParams.get("address") ?? "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? 10);
        const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.trunc(limitRaw))) : 10;
        const offset = Number.isFinite(offsetRaw) ? Math.min(10_000, Math.max(0, Math.trunc(offsetRaw))) : 0;

        try {
          const store = await import("@/lib/points/points-store.server");
          const ready = await store.ledgerReady();
          if (!ready.ready) {
            return Response.json({ error: "Creator Points ledger is not available yet." }, { status: 503 });
          }
          const lower = address.toLowerCase();
          const [totals, history] = await Promise.all([
            store.creatorTotals(ACTIVE_CHAIN_ID, lower),
            store.creatorHistory(ACTIVE_CHAIN_ID, lower, limit, offset),
          ]);
          return Response.json(
            {
              address: lower,
              chainId: ACTIVE_CHAIN_ID,
              totalPoints: totals.totalPoints,
              pointsToday: totals.pointsToday,
              pointsThisMonth: totals.pointsThisMonth,
              events: totals.events,
              lastEventAt: totals.lastEventAt,
              rank: null,
              history: history.entries,
              total: history.total,
              limit,
              offset,
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Creator Points unavailable";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});
