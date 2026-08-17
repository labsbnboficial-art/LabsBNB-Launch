// External trigger for the Signal Engine (cron / uptime monitor).
//
//   POST https://project--<id>-dev.lovable.app/api/public/signals/run
//   Header: x-signals-secret: <SIGNALS_CRON_SECRET>
//
// The endpoint is public by prefix, so the shared secret is the only gate.
// It performs no write of its own and contains NO engine logic: it calls the
// exact same runSignalEngine() the admin "RUN ENGINE NOW" button calls, which
// owns the distributed lock, deduplication and Telegram dispatch.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function handle(request: Request) {
  const startedAt = Date.now();
  const secret = process.env.SIGNALS_CRON_SECRET;
  if (!secret) {
    console.error("[SIGNAL_CRON] failed reason=missing-secret");
    return Response.json(
      { success: false, error: "SIGNALS_CRON_SECRET no está configurado en el backend." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const header = request.headers.get("x-signals-secret") ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const provided = header || bearer;
  // Never log the provided or expected value — only the outcome.
  if (!provided || !safeEqual(provided, secret)) {
    console.warn(`[SIGNAL_CRON] failed reason=${provided ? "invalid-secret" : "missing-secret-header"}`);
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }

  console.info("[SIGNAL_CRON] start");
  try {
    const { runSignalEngine } = await import("@/lib/signals/signal-engine.server");
    const origin = new URL(request.url).origin;
    console.info("[SIGNAL_CRON] engine_started");
    const result = await runSignalEngine({ trigger: "cron", baseUrl: origin });
    const durationMs = Date.now() - startedAt;

    if (result.locked) {
      console.info(`[SIGNAL_CRON] skipped_locked durationMs=${durationMs}`);
      return Response.json(
        {
          success: true,
          skippedLocked: true,
          ranAt: result.ranAt,
          engineEnabled: result.engineEnabled,
          tokensScanned: 0,
          detected: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
          durationMs,
          notes: result.notes,
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }

    console.info(
      `[SIGNAL_CRON] engine_completed tokens=${result.tokensScanned} detected=${result.detected} ` +
        `sent=${result.sent} skipped=${result.skipped} failed=${result.failed} durationMs=${durationMs}`,
    );
    return Response.json(
      {
        success: true,
        skippedLocked: false,
        ranAt: result.ranAt,
        engineEnabled: result.engineEnabled,
        tokensScanned: result.tokensScanned,
        detected: result.detected,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        durationMs,
        notes: result.notes,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : "Error desconocido en el motor de señales.";
    console.error(`[SIGNAL_CRON] failed durationMs=${durationMs} error=${message}`);
    // 200-with-success:false keeps schedulers from hammering retries in a loop.
    return Response.json(
      { success: false, error: message, durationMs },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/public/signals/run")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
