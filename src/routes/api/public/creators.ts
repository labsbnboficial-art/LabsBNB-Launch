// Public read-only Creator API. No PII, no writes, no auth needed.
//   GET /api/public/creators?sort=score&limit=50
//   GET /api/public/creators?address=0x...
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const querySchema = z.object({
  sort: z.enum(["score", "graduations", "volume", "trending"]).default("score"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

export const Route = createFileRoute("/api/public/creators")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) {
          return Response.json({ error: "Invalid query" }, { status: 400 });
        }
        try {
          const svc = await import("@/lib/creator/creator-service.server");
          const body = parsed.data.address
            ? await svc.getCreatorProfile(parsed.data.address)
            : await svc.getCreatorLeaderboard(parsed.data.sort, parsed.data.limit);
          return Response.json(body, {
            headers: { "cache-control": "public, max-age=60" },
          });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Creator data unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
