// Server-only Telegram Bot API abstraction.
// The bot token lives ONLY in the backend secret TELEGRAM_BOT_TOKEN and is never
// returned to the client, logged, or embedded in error messages.

const API = "https://api.telegram.org";

export const DEFAULT_CHANNEL = "@LabsBNBSignals";

export function botToken(): string | undefined {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}

export function channelId(): string {
  const c = process.env.TELEGRAM_CHANNEL_ID;
  return c && c.trim() ? c.trim() : DEFAULT_CHANNEL;
}

export function hasBotToken(): boolean {
  return !!botToken();
}

export class TelegramError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.code = code;
  }
}

/** Maps Telegram/HTTP failures to actionable, secret-free messages (Spanish). */
export function describeTelegramError(status: number, description: string): string {
  const d = (description || "").toLowerCase();
  if (status === 401 || d.includes("unauthorized")) {
    return "Bot token inválido o revocado (401 Unauthorized). Regenera el token en @BotFather y actualiza el secret TELEGRAM_BOT_TOKEN.";
  }
  if (d.includes("chat not found")) {
    return "Canal no encontrado. Verifica que el identificador del canal sea correcto y que el bot ya haya sido añadido al canal.";
  }
  if (d.includes("bot was blocked") || d.includes("bot was kicked")) {
    return "El bot fue bloqueado/expulsado del canal. Vuelve a añadirlo como administrador.";
  }
  if (d.includes("not enough rights") || d.includes("have no rights") || d.includes("need administrator")) {
    return "El bot no tiene permisos suficientes. Debe ser administrador del canal con permiso para publicar mensajes.";
  }
  if (status === 403) {
    return "Acceso denegado por Telegram: el bot no puede publicar en este canal (¿no es administrador?).";
  }
  if (status === 429 || d.includes("too many requests")) {
    return "Telegram aplicó rate limit (429). Espera unos segundos y vuelve a intentar.";
  }
  if (status === 400) {
    return `Petición inválida hacia Telegram: ${description || "bad request"}.`;
  }
  if (status >= 500) {
    return "La API de Telegram no está disponible en este momento. Reintenta más tarde.";
  }
  return description || `Error desconocido de Telegram (HTTP ${status}).`;
}

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

async function callTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = botToken();
  if (!token) {
    throw new TelegramError(
      "TELEGRAM_BOT_TOKEN no está configurado en el backend. Añádelo desde el gestor de secrets.",
      0,
    );
  }
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TelegramError("No se pudo contactar con la API de Telegram (fallo de red).", 0);
  }

  let json: TgResponse<T>;
  try {
    json = (await res.json()) as TgResponse<T>;
  } catch {
    throw new TelegramError(describeTelegramError(res.status, ""), res.status);
  }

  if (!res.ok || !json.ok) {
    // Never log the token: only the method + safe description.
    console.error(`[telegram] ${method} failed (${res.status}): ${json.description ?? "no description"}`);
    throw new TelegramError(describeTelegramError(res.status, json.description ?? ""), res.status);
  }
  return json.result as T;
}

export type BotInfo = { id: number; username?: string; first_name?: string };

export async function getBotInfo(): Promise<BotInfo> {
  return callTelegram<BotInfo>("getMe", {});
}

export type ChatInfo = { id: number; title?: string; username?: string; type?: string };

/** Resolves the numeric chat id for the configured channel (safe to store). */
export async function resolveChannel(chat?: string): Promise<ChatInfo> {
  return callTelegram<ChatInfo>("getChat", { chat_id: chat ?? channelId() });
}

export async function sendTelegramMessage(
  text: string,
  opts: { chat?: string; parseMode?: "HTML" | "MarkdownV2"; disablePreview?: boolean } = {},
): Promise<{ message_id: number }> {
  return callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: opts.chat ?? channelId(),
    text,
    parse_mode: opts.parseMode ?? "HTML",
    disable_web_page_preview: opts.disablePreview ?? false,
  });
}

export async function sendTelegramPhoto(
  photo: string,
  caption?: string,
  opts: { chat?: string; parseMode?: "HTML" | "MarkdownV2" } = {},
): Promise<{ message_id: number }> {
  return callTelegram<{ message_id: number }>("sendPhoto", {
    chat_id: opts.chat ?? channelId(),
    photo,
    caption,
    parse_mode: opts.parseMode ?? "HTML",
  });
}

export const TEST_MESSAGE = [
  "🧪 <b>LABSBNB TELEGRAM SIGNALS</b>",
  "",
  "🟢 Connection successful",
  "",
  "The LabsBNB Launchpad Telegram Signal System is now connected.",
  "",
  "🚀 Real-time token signals coming soon.",
  "",
  "https://t.me/LabsBNBSignals",
].join("\n");

/** Full connectivity check: token → bot identity → channel → publish test message. */
export async function testTelegramConnection(): Promise<{
  bot: BotInfo;
  chat: ChatInfo;
  messageId: number;
}> {
  const bot = await getBotInfo();
  const chat = await resolveChannel();
  const sent = await sendTelegramMessage(TEST_MESSAGE, { disablePreview: false });
  return { bot, chat, messageId: sent.message_id };
}
