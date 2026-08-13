import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Admin-only Telegram endpoints. Every handler is gated by the admin session
 * (username/password + PIN) and the CSRF token, and the bot token never leaves
 * the server: only booleans and safe metadata are returned.
 */

// Ad-hoc rate limit for the test endpoint (no platform primitive available).
const TEST_COOLDOWN_MS = 20_000;
const lastTest = new Map<string, number>();

export const getTelegramStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { csrf: string }) => z.object({ csrf: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const auth = await import("@/lib/admin-auth.server");
    await auth.requireAdmin(data.csrf);
    const tg = await import("@/lib/telegram/telegram.server");

    const configured = tg.hasBotToken();
    const channel = tg.channelId();
    if (!configured) {
      return { configured: false, channel, connected: false, bot: null as string | null, chatTitle: null as string | null, error: "TELEGRAM_BOT_TOKEN no está configurado." };
    }
    try {
      const bot = await tg.getBotInfo();
      const chat = await tg.resolveChannel();
      return {
        configured: true,
        channel,
        connected: true,
        bot: bot.username ? `@${bot.username}` : String(bot.id),
        chatTitle: chat.title ?? chat.username ?? String(chat.id),
        chatId: chat.id,
        error: null as string | null,
      };
    } catch (e) {
      return {
        configured: true,
        channel,
        connected: false,
        bot: null as string | null,
        chatTitle: null as string | null,
        error: e instanceof Error ? e.message : "Error desconocido.",
      };
    }
  });

export const testTelegram = createServerFn({ method: "POST" })
  .inputValidator((data: { csrf: string }) => z.object({ csrf: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const auth = await import("@/lib/admin-auth.server");
    const cur = await auth.requireAdmin(data.csrf);
    const adminId = cur.account.id;

    const now = Date.now();
    const prev = lastTest.get(adminId) ?? 0;
    if (now - prev < TEST_COOLDOWN_MS) {
      throw new Error(`Espera ${Math.ceil((TEST_COOLDOWN_MS - (now - prev)) / 1000)}s antes de repetir el test.`);
    }
    lastTest.set(adminId, now);

    const tg = await import("@/lib/telegram/telegram.server");
    try {
      const r = await tg.testTelegramConnection();
      await auth.audit("admin.telegram.test", adminId, {
        ok: true,
        channel: tg.channelId(),
        message_id: r.messageId,
      });
      return {
        ok: true as const,
        bot: r.bot.username ? `@${r.bot.username}` : String(r.bot.id),
        chatTitle: r.chat.title ?? r.chat.username ?? String(r.chat.id),
        chatId: r.chat.id,
        messageId: r.messageId,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error desconocido.";
      await auth.audit("admin.telegram.test", adminId, { ok: false, error: message });
      throw new Error(message);
    }
  });
