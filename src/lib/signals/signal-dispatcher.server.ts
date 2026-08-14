// Signal → dedupe → formatter → Telegram → signal_log.
//
// This is the ONLY module allowed to publish a signal. It never touches the bot
// token: it goes through `sendTelegramMessage` / `sendTelegramPhoto` from the
// Phase 1 service. Every outcome (sent / skipped / failed) is persisted.
import { renderSignal, siteUrl } from "./signal-formatters";
import type { SignalCandidate } from "./signal-types";
import {
  candidateFingerprint,
  markFailed,
  markSent,
  recordSkip,
  reserve,
} from "./signal-dedupe.server";

export type DispatchResult = {
  status: "sent" | "skipped" | "failed";
  signalType: string;
  tokenAddress: string;
  fingerprint: string;
  telegramMessageId?: number;
  reason?: string;
  error?: string;
};

export type DispatchOptions = {
  symbol?: string | null;
  baseUrl?: string;
  /** Image URL for the signal (sendTelegramPhoto). Optional. */
  photo?: string | null;
  /** Test seam only — never used by the runner. */
  now?: () => number;
};

const MAX_RATE_LIMIT_RETRIES = 1;
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function skipped(candidate: SignalCandidate, fingerprint: string, reason: string): DispatchResult {
  console.warn(`[SIGNAL_SKIPPED] ${candidate.type} ${candidate.tokenAddress} reason=${reason}`);
  return { status: "skipped", signalType: candidate.type, tokenAddress: candidate.tokenAddress, fingerprint, reason };
}

/**
 * Publishes one candidate. Deduplication is mandatory and happens BEFORE any
 * Telegram call, so re-running the engine can never republish the same event.
 */
export async function dispatchSignal(
  candidate: SignalCandidate,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const symbol = opts.symbol ?? null;
  const base = siteUrl(opts.baseUrl);

  // 1. Safety gate — Telegram must be usable before we reserve anything.
  const tg = await import("@/lib/telegram/telegram.server");
  if (!tg.hasBotToken()) {
    const fp = candidateFingerprint(candidate);
    await recordSkip(candidate, "telegram-not-configured", symbol);
    return skipped(candidate, fp, "telegram-not-configured");
  }

  // 2. Dedupe (atomic reservation).
  const reservation = await reserve(candidate, symbol);
  if (!reservation.reserved) {
    return skipped(candidate, reservation.fingerprint, reservation.reason);
  }
  const fingerprint = reservation.fingerprint;

  // 3. Format with the SAME formatter the admin preview uses.
  const rendered = renderSignal(candidate, base);
  console.info(`[SIGNAL_DISPATCH] ${candidate.type} ${candidate.tokenAddress} fp=${fingerprint.slice(0, 12)}`);

  // 4. Publish, honouring Telegram rate limits (bounded retries, never infinite).
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const sent = opts.photo
        ? await tg.sendTelegramPhoto(opts.photo, rendered.text)
        : await tg.sendTelegramMessage(rendered.text, { buttons: rendered.buttons, disablePreview: true });
      await markSent(fingerprint, sent.message_id);
      console.info(`[SIGNAL_SENT] ${candidate.type} ${candidate.tokenAddress} message_id=${sent.message_id}`);
      return {
        status: "sent",
        signalType: candidate.type,
        tokenAddress: candidate.tokenAddress,
        fingerprint,
        telegramMessageId: sent.message_id,
      };
    } catch (e) {
      const isTg = e instanceof tg.TelegramError;
      const code = isTg ? (e as InstanceType<typeof tg.TelegramError>).code : 0;
      const retryAfter = isTg ? (e as InstanceType<typeof tg.TelegramError>).retryAfter : null;
      const message = e instanceof Error ? e.message : "Error desconocido de Telegram.";

      if (code === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const waitMs = Math.min(MAX_RETRY_WAIT_MS, Math.max(1, retryAfter ?? 3) * 1000);
        console.warn(`[SIGNAL_DISPATCH] rate limited, waiting ${waitMs}ms before retry`);
        await sleep(waitMs);
        continue;
      }

      await markFailed(fingerprint, message, code || null);
      console.error(`[SIGNAL_FAILED] ${candidate.type} ${candidate.tokenAddress} code=${code} ${message}`);
      return {
        status: "failed",
        signalType: candidate.type,
        tokenAddress: candidate.tokenAddress,
        fingerprint,
        error: message,
      };
    }
  }

  await markFailed(fingerprint, "Telegram rate limit persistente (429).", 429);
  return {
    status: "failed",
    signalType: candidate.type,
    tokenAddress: candidate.tokenAddress,
    fingerprint,
    error: "Telegram rate limit persistente (429).",
  };
}
