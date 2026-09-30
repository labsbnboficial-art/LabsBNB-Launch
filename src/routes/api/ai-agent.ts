// AI Agent Co-Founder — per-token agent endpoint (chat + meme captions).
// Personality/lore come from the token's saved AI Co-Founder config; metrics
// come only from the on-chain tools. Streams plain text to the browser.
import { createFileRoute } from "@tanstack/react-router";
import { TOOL_SCHEMAS, runTool } from "@/lib/launchpad/ai-tools.server";
import { getTokenMarketData } from "@/lib/launchpad/market-data";
import { AI_COFOUNDER_LABEL, type AiCofounderConfig } from "@/lib/ai-cofounder";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";
const MAX_STEPS = 5;
const RUN_HEADER = "X-Lovable-AIG-Run-ID";

const TOOLS = TOOL_SCHEMAS.map((t) => ({ type: "function", ...t.function }));
const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const w = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  w.push(now);
  hits.set(ip, w);
  return w.length > 15;
}

const TONE: Record<string, string> = {
  degen: "Hablas como un degen cripto con hype máximo, emojis de cohete y jerga (wagmi, gm, ser).",
  sarcastic: "Eres sarcástico e irónico, humor ácido pero nunca ofensivo.",
  financial: "Tono analítico y sobrio, como un analista: datos, métricas y contexto.",
  meme_lord: "Hablas en cultura meme pura, referencias a memes clásicos y frases cortas.",
};

async function loadConfig(address: string): Promise<AiCofounderConfig | null> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  const { data } = await adminClient
    .from("admin_config")
    .select("value")
    .eq("key", `ai_cofounder:${address.toLowerCase()}`)
    .maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  if (!v) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as AiCofounderConfig;
}

function persona(cfg: AiCofounderConfig, symbol: string, address: string) {
  return [
    `Eres el AI Agent Co-Founder del token $${symbol} (${address}) en el launchpad LabsBNB, BNB Smart Chain (chain 56).`,
    `Personalidad: ${AI_COFOUNDER_LABEL[cfg.personality].label}. ${TONE[cfg.personality]}`,
    cfg.lore ? `Lore del token definido por su creador: """${cfg.lore}"""` : "",
    "Responde en el idioma del usuario (por defecto español), de forma breve.",
    "REGLAS: usa las tools para cualquier dato; nunca inventes precio, market cap, holders, volumen ni progreso de curva.",
    "Si no hay datos reales, dilo. No des consejo financiero ni prometas subidas. Nunca pidas claves privadas ni seed phrases. No ejecutas transacciones.",
  ]
    .filter(Boolean)
    .join("\n");
}

type Item = Record<string, unknown> & { type?: string };

/** One streamed Responses call. Forwards text deltas; returns output items. */
async function responsesStep(
  key: string,
  runId: { v?: string },
  input: Item[],
  withTools: boolean,
  onText: (s: string) => void,
  signal: AbortSignal,
): Promise<{ items: Item[]; status: number; error?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "fetch",
  };
  if (runId.v) headers[RUN_HEADER] = runId.v;
  const res = await fetch(GATEWAY, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: MODEL,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      ...(withTools ? { tools: TOOLS } : {}),
    }),
  });
  runId.v ??= res.headers.get(RUN_HEADER) ?? undefined;
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[AI_AGENT] gateway", res.status, detail.slice(0, 300));
    let msg: string | undefined;
    try {
      msg = (JSON.parse(detail) as { error?: { message?: string }; message?: string }).error?.message;
    } catch {
      /* ignore */
    }
    return { items: [], status: res.status, error: msg };
  }
  const items: Item[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let ev: { type?: string; delta?: string; item?: Item; response?: { error?: { message?: string } } };
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.type === "response.output_text.delta" && ev.delta) onText(ev.delta);
      else if (ev.type === "response.output_item.done" && ev.item) items.push(ev.item);
      else if (ev.type === "response.failed" || ev.type === "error")
        return { items, status: 500, error: ev.response?.error?.message ?? "La IA falló." };
    }
  }
  return { items, status: 200 };
}

function errorFor(status: number, fallback?: string) {
  if (status === 429) return "Límite de uso de IA alcanzado. Intenta en unos minutos.";
  if (status === 402) return "Créditos de IA agotados en el workspace.";
  if (status === 403) return fallback ?? "Acceso a la IA denegado.";
  return fallback ?? "El servicio de IA no respondió correctamente.";
}

export const Route = createFileRoute("/api/ai-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ error: "AI no configurada." }, { status: 500 });
        const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "anon";
        if (rateLimited(ip)) return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429 });

        let body: { address?: string; mode?: "chat" | "meme"; messages?: { role: string; content: string }[]; idea?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Petición inválida." }, { status: 400 });
        }
        const address = String(body.address ?? "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) return Response.json({ error: "Dirección inválida." }, { status: 400 });

        const cfg = await loadConfig(address);
        if (!cfg?.enabled) return Response.json({ error: "Este token no tiene AI Agent activo." }, { status: 404 });
        const market = await getTokenMarketData(address).catch(() => null);
        const symbol = market?.symbol ?? "TOKEN";
        const system = persona(cfg, symbol, address);

        let input: Item[];
        let withTools = true;
        if (body.mode === "meme") {
          withTools = false;
          const snapshot = market
            ? {
                name: market.name,
                symbol: market.symbol,
                price: market.price,
                marketCap: market.marketCap,
                priceChange24h: market.priceChange24h,
                holders: market.holders,
                bondingProgress: market.bondingProgress,
                graduationStatus: market.graduationStatus,
              }
            : null;
          input = [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                "Crea UN meme para la comunidad del token, adaptado a su estado actual de curva y a tu personalidad.",
                `Datos on-chain reales: ${JSON.stringify(snapshot, bigintSafe)}`,
                body.idea ? `Idea del usuario: ${String(body.idea).slice(0, 300)}` : "",
                'Responde SOLO con JSON: {"top":"texto superior (máx 50 caracteres)","bottom":"texto inferior (máx 60 caracteres)","caption":"texto para compartir en redes con $SYMBOL (máx 200 caracteres)"}. Sin markdown.',
              ].join("\n"),
            },
          ];
        } else {
          const history = (body.messages ?? [])
            .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-16)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
          if (!history.length) return Response.json({ error: "Mensaje vacío." }, { status: 400 });
          input = [{ role: "system", content: system }, ...history];
        }

        const runId: { v?: string } = {};
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (s: string) => controller.enqueue(enc.encode(s));
            try {
              for (let step = 0; step < MAX_STEPS; step++) {
                let wrote = false;
                const r = await responsesStep(key, runId, input, withTools, (d) => {
                  wrote = true;
                  send(d);
                }, request.signal);
                if (r.status !== 200) {
                  send(`\n\n⚠️ ${errorFor(r.status, r.error)}`);
                  break;
                }
                const calls = r.items.filter((i) => i.type === "function_call");
                if (!calls.length) {
                  if (!wrote) send("No tengo suficientes datos reales para responder eso.");
                  break;
                }
                input = [...input, ...r.items];
                for (const c of calls) {
                  let args: Record<string, unknown> = {};
                  try {
                    args = JSON.parse(String(c.arguments ?? "{}"));
                  } catch {
                    /* empty */
                  }
                  if (!args.address) args.address = address;
                  let result: unknown;
                  try {
                    result = await runTool(String(c.name), args);
                  } catch (e) {
                    result = { error: (e as Error).message };
                  }
                  input.push({
                    type: "function_call_output",
                    call_id: c.call_id,
                    output: JSON.stringify(result, bigintSafe).slice(0, 12_000),
                  });
                }
              }
            } catch (e) {
              if (!request.signal.aborted) {
                console.error("[AI_AGENT] failure", e);
                send("\n\n⚠️ No se pudo consultar la IA en este momento.");
              }
            }
            controller.close();
          },
        });
        const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return new Response(stream, { headers });
      },
    },
  },
});
