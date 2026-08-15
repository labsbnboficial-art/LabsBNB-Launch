// External trigger for the Signal Engine (cron / uptime monitor).
//
//   POST https://project--<id>-dev.lovable.app/api/public/signals/run
//   Header: x-signals-secret: <SIGNALS_CRON_SECRET>
//
// The endpoint is public by prefix, so the shared secret is the only gate.
// It performs no write of its own: everything goes through the engine.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function handle(request: Request) {
  const secret = process.env.SIGNALS_CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "SIGNALS_CRON_SECRET no está configurado en el backend." },
      { status: 503 },
    );
  }

  const header = request.headers.get("x-signals-secret") ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const provided = header || bearer;
  if (!provided || !safeEqual(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runSignalEngine } = await import("@/lib/signals/signal-engine.server");
  const origin = new URL(request.url).origin;
  const result = await runSignalEngine({ trigger: "cron", baseUrl: origin });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/signals/run")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
