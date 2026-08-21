// 🤖 LabsBNB AI Copilot — floating bubble + chat panel.
//
// Client never sees the AI key: it posts to /api/ai-copilot, which runs the
// tool loop against real on-chain data. Page context (current token) is sent
// automatically so the user never has to paste an address.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Bot, Copy, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

const GLOBAL_ACTIONS = [
  "🔥 Trending",
  "👑 King of the Hill",
  "🚀 New launches",
  "📊 Market overview",
  "🏆 Top gainers",
  "💰 Top volume",
];

const TOKEN_ACTIONS = [
  "📊 Analiza este token",
  "📈 Analiza el gráfico",
  "🏆 ¿Cuál es su ATH?",
  "💰 ¿Cuánto volumen tiene?",
  "👥 ¿Cuántos holders?",
  "🔥 Actividad reciente",
];

function useTokenAddress() {
  const location = useLocation();
  return useMemo(() => {
    const m = location.pathname.match(/\/token\/(0x[a-fA-F0-9]{40})/);
    return { route: location.pathname, tokenAddress: m ? m[1] : null };
  }, [location.pathname]);
}

/** Minimal markdown rendering: headings, bold, bullets — no external dep. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((raw, i) => {
        const line = raw.replace(/\*\*(.+?)\*\*/g, "§$1§");
        const parts = line.split("§");
        const body = parts.map((p, j) =>
          j % 2 ? (
            <strong key={j} className="font-semibold text-foreground">
              {p}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        );
        if (!raw.trim()) return <div key={i} className="h-1" />;
        if (/^#{1,6}\s/.test(raw))
          return (
            <div key={i} className="font-display text-sm font-semibold text-primary">
              {raw.replace(/^#{1,6}\s/, "")}
            </div>
          );
        if (/^[-*]\s/.test(raw))
          return (
            <div key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{body}</span>
            </div>
          );
        return <div key={i}>{body}</div>;
      })}
    </div>
  );
}

export function AiCopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ctx = useTokenAddress();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, busy]);

  async function send(text: string) {
    const clean = text.trim().slice(0, 2000);
    if (!clean || busy) return;
    const next = [...messages, { role: "user" as const, content: clean }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: ctx }),
      });
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "AI no disponible.");
      setMessages([...next, { role: "assistant", content: data.content ?? "" }]);
    } catch (e) {
      setMessages([
        ...next,
        { role: "assistant", content: `No pude responder: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const actions = ctx.tokenAddress ? TOKEN_ACTIONS : GLOBAL_ACTIONS;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir LabsBNB AI"
          className="group fixed right-4 bottom-5 z-40 flex items-center gap-2 rounded-full border border-primary/40 bg-background/80 px-3.5 py-2.5 shadow-lg backdrop-blur sm:px-4 sm:py-3 transition-transform duration-200 hover:scale-[1.04] active:scale-95"
          style={{
            boxShadow: "0 0 0 1px oklch(0.7 0.15 210 / 0.15), 0 8px 30px oklch(0.7 0.15 210 / 0.25)",
            marginBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <Bot className="h-5 w-5 text-primary" />
          </span>
          <span className="hidden text-sm font-medium sm:inline">LabsBNB AI</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-0"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className="animate-fade-in flex h-full w-full flex-col border-l border-white/10 bg-background/95 backdrop-blur-xl sm:w-[420px]"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-semibold">
                  LabsBNB AI <span className="ml-1 text-[10px] text-success">● Online</span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">Your Launchpad Copilot</div>
              </div>
              <button
                type="button"
                onClick={() => setMessages([])}
                aria-label="Limpiar conversación"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Pregúntame por cualquier token, el mercado o cómo funciona el launchpad. Solo uso
                    datos reales on-chain.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => send(a)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition-all duration-200 hover:border-primary/40 hover:bg-primary/10"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className="animate-fade-in">
                  {m.role === "user" ? (
                    <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                      {m.content}
                    </div>
                  ) : (
                    <div className="group max-w-full">
                      <Rich text={m.content} />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(m.content);
                          toast.success("Respuesta copiada");
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                  <span className="ml-2 text-xs">Analizando datos on-chain…</span>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-white/10 p-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder="Pregunta sobre un token, el mercado o el launchpad…"
                  className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-primary/50"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Enviar"
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                AI analysis is informational and not financial advice.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
