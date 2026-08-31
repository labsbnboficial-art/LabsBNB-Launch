// LabsBNB AI Copilot — server endpoint.
//
// The Lovable AI key stays server-side. The model runs a bounded tool loop
// against the launchpad data layer (real on-chain data only) and returns the
// final answer as JSON. No mock data, no autonomous transactions.
import { createFileRoute } from "@tanstack/react-router";
import { TOOL_SCHEMAS, runTool } from "@/lib/launchpad/ai-tools.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";
const MAX_MESSAGE = 2_000;
const MAX_HISTORY = 20;
const MAX_STEPS = 5;

type ChatMessage = { role: "user" | "assistant"; content: string };

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

// naive per-IP rate limit (best effort inside a stateless worker instance)
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const window = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  window.push(now);
  hits.set(ip, window);
  return window.length > 20;
}

function systemPrompt(ctx: { route?: string; tokenAddress?: string | null }) {
  return [
    "Eres LabsBNB AI, el copiloto del launchpad LabsBNB en BNB Smart Chain Mainnet (chain 56).",
    "Respondes en el idioma del usuario (por defecto español).",
    "REGLAS ESTRICTAS:",
    "- Usa SIEMPRE las tools para obtener datos. Nunca inventes precios, volumen, holders, ATH, market cap, trades ni velas.",
    "- Si una tool devuelve null o no hay datos, responde exactamente que no tienes datos reales suficientes.",
    "- No des consejo financiero. Nunca digas compra/vende/va a subir. Usa 'se observa', 'podría indicar', 'es consistente con'.",
    "- Nunca pidas private key, seed phrase ni contraseñas. No ejecutas transacciones: el usuario opera desde la UI.",
    "- Con pocas velas, dilo explícitamente en vez de interpretar una tendencia.",
    "FORMATO: markdown compacto, encabezado con el símbolo, métricas en líneas cortas con etiqueta y valor, y cierra con:",
    "'AI analysis is informational and not financial advice.'",
    ctx.tokenAddress
      ? `CONTEXTO: el usuario está viendo el token ${ctx.tokenAddress}. Cuando diga "este token" o "su", se refiere a esa dirección.`
      : `CONTEXTO: el usuario está en ${ctx.route ?? "el launchpad"}.`,
  ].join("\n");
}

export const Route = createFileRoute("/api/ai-copilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ error: "AI no configurada en el servidor." }, { status: 500 });

        const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "anon";
        if (rateLimited(ip)) {
          return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429 });
        }

        let body: { messages?: ChatMessage[]; context?: { route?: string; tokenAddress?: string | null } };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Petición inválida." }, { status: 400 });
        }

        const history = (body.messages ?? [])
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));
        if (!history.length) return Response.json({ error: "Mensaje vacío." }, { status: 400 });

        const ctx = body.context ?? {};
        const messages: Array<Record<string, unknown>> = [
          { role: "system", content: systemPrompt(ctx) },
          ...history,
        ];

        try {
          for (let step = 0; step < MAX_STEPS; step += 1) {
            const res = await fetch(GATEWAY, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Lovable-API-Key": key,
                "X-Lovable-AIG-SDK": "fetch",
              },
              body: JSON.stringify({ model: MODEL, messages, tools: TOOL_SCHEMAS }),
            });

            if (res.status === 429) {
              return Response.json({ error: "Límite de uso de IA alcanzado. Intenta en unos minutos." }, { status: 429 });
            }
            if (res.status === 402) {
              return Response.json({ error: "Créditos de IA agotados en el workspace." }, { status: 402 });
            }
            if (!res.ok) {
              const detail = await res.text();
              console.error("[AI_COPILOT] gateway error", res.status, detail.slice(0, 400));
              return Response.json({ error: "El servicio de IA no respondió correctamente." }, { status: 502 });
            }

            const data = (await res.json()) as {
              choices?: Array<{
                message?: {
                  content?: string | null;
                  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
                };
              }>;
            };
            const msg = data.choices?.[0]?.message;
            const calls = msg?.tool_calls ?? [];

            if (!calls.length) {
              return Response.json({
                content: msg?.content?.trim() || "No tengo suficientes datos reales para responder eso.",
              });
            }

            messages.push({ role: "assistant", content: msg?.content ?? "", tool_calls: calls });
            for (const call of calls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                args = {};
              }
              let result: unknown;
              try {
                result = await runTool(call.function.name, args);
              } catch (e) {
                result = { error: (e as Error).message };
              }
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(result, bigintSafe).slice(0, 12_000),
              });
            }
          }
          return Response.json({ content: "No pude completar el análisis con los datos disponibles." });
        } catch (e) {
          console.error("[AI_COPILOT] failure", e);
          return Response.json({ error: "No se pudo consultar la IA en este momento." }, { status: 500 });
        }
      },
    },
  },
});
