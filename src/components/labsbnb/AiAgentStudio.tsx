import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Send, Loader2, ImageIcon, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAiCofounder } from "@/lib/ai-cofounder.functions";
import { AI_COFOUNDER_LABEL } from "@/lib/ai-cofounder";

type Msg = { role: "user" | "assistant"; content: string };
type Meme = { top: string; bottom: string; caption: string };

async function streamAgent(body: Record<string, unknown>, onChunk: (s: string) => void) {
  const res = await fetch("/api/ai-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "Error de IA");
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const s = dec.decode(value, { stream: true });
    full += s;
    onChunk(full);
  }
  return full;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawMeme(canvas: HTMLCanvasElement, meme: Meme, img: HTMLImageElement | null, symbol: string) {
  const S = 600;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue("--background").trim() || "#0b0b0f";
  ctx.fillStyle = bg.startsWith("#") || bg.startsWith("rgb") || bg.startsWith("oklch") ? bg : "#0b0b0f";
  ctx.fillRect(0, 0, S, S);
  if (img) {
    const r = Math.max(S / img.width, S / img.height);
    ctx.drawImage(img, (S - img.width * r) / 2, (S - img.height * r) / 2, img.width * r, img.height * r);
  } else {
    ctx.fillStyle = "#f0b90b";
    ctx.font = "bold 120px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`$${symbol}`, S / 2, S / 2 + 40);
  }
  ctx.textAlign = "center";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 46px Impact, 'Arial Black', sans-serif";
  const draw = (text: string, top: boolean) => {
    const lines = wrap(ctx, text.toUpperCase(), S - 40);
    lines.forEach((l, i) => {
      const y = top ? 60 + i * 50 : S - 24 - (lines.length - 1 - i) * 50;
      ctx.strokeText(l, S / 2, y);
      ctx.fillText(l, S / 2, y);
    });
  };
  draw(meme.top, true);
  draw(meme.bottom, false);
  ctx.font = "bold 16px sans-serif";
  ctx.lineWidth = 3;
  ctx.textAlign = "right";
  ctx.strokeText("LabsBNB", S - 12, S - 6);
  ctx.fillText("LabsBNB", S - 12, S - 6);
}

export function AiAgentStudio({ address, symbol, image }: { address: string; symbol: string; image: string | null }) {
  const cfgQ = useQuery({
    queryKey: ["ai-cofounder", address.toLowerCase()],
    queryFn: () => getAiCofounder({ data: { address } }),
    staleTime: 60_000,
  });
  const cfg = cfgQ.data;

  const [tab, setTab] = useState<"chat" | "meme">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const [idea, setIdea] = useState("");
  const [meme, setMeme] = useState<Meme | null>(null);
  const [memeBusy, setMemeBusy] = useState(false);
  const [memeErr, setMemeErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [msgs]);

  useEffect(() => {
    if (!image) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      if (meme && canvasRef.current) drawMeme(canvasRef.current, meme, img, symbol);
    };
    img.src = image;
  }, [image]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (meme && canvasRef.current) drawMeme(canvasRef.current, meme, imgRef.current, symbol);
  }, [meme, symbol]);

  if (cfgQ.isLoading) return null;
  if (!cfg?.enabled) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Bot className="h-4 w-4 text-primary" /> AI Agent & Meme Studio
        </div>
        Este token no tiene un AI Agent Co-Founder activo.
      </div>
    );
  }
  const p = AI_COFOUNDER_LABEL[cfg.personality];

  const send = async (q?: string) => {
    const content = (q ?? text).trim();
    if (!content || busy) return;
    setText("");
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await streamAgent({ address, mode: "chat", messages: next }, (full) =>
        setMsgs([...next, { role: "assistant", content: full }]),
      );
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const genMeme = async () => {
    setMemeBusy(true);
    setMemeErr(null);
    try {
      const raw = await streamAgent({ address, mode: "meme", idea }, () => {});
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(raw.includes("⚠️") ? raw.replace(/.*⚠️/s, "").trim() : "La IA no devolvió un meme válido.");
      const j = JSON.parse(m[0]) as Partial<Meme>;
      setMeme({
        top: String(j.top ?? "").slice(0, 60),
        bottom: String(j.bottom ?? "").slice(0, 70),
        caption: String(j.caption ?? `$${symbol} on LabsBNB`).slice(0, 220),
      });
    } catch (e) {
      setMemeErr((e as Error).message);
    } finally {
      setMemeBusy(false);
    }
  };

  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareX = () =>
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(meme?.caption ?? "")}&url=${encodeURIComponent(pageUrl)}`, "_blank");
  const shareTg = () =>
    window.open(`https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(meme?.caption ?? "")}`, "_blank");
  const download = () => {
    try {
      const a = document.createElement("a");
      a.href = canvasRef.current!.toDataURL("image/png");
      a.download = `${symbol}-meme.png`;
      a.click();
    } catch {
      setMemeErr("No se pudo exportar la imagen (imagen del token externa).");
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full brand-gradient text-xl">{p.emoji}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold">AI Agent & Meme Studio</h3>
          <div className="text-xs text-muted-foreground">
            Co-Founder de ${symbol} · <span className="text-foreground">{p.label}</span> — {p.hint}
          </div>
        </div>
        <div className="flex gap-1 text-xs">
          {(["chat", "meme"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1 ${tab === t ? "border-primary/60 bg-primary/10" : "border-border text-muted-foreground"}`}
            >
              {t === "chat" ? "Chat" : "Meme Studio"}
            </button>
          ))}
        </div>
      </div>
      {cfg.lore && <p className="mb-4 whitespace-pre-line rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">{cfg.lore}</p>}

      {tab === "chat" ? (
        <div>
          <div className="max-h-80 min-h-40 space-y-3 overflow-y-auto pr-1">
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {["¿Cómo va la curva?", "Dame las métricas de hoy", "¿Quiénes son los top holders?", "Preséntate"].map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`whitespace-pre-wrap break-words text-sm ${m.role === "user" ? "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-primary-foreground" : ""}`}>
                  {m.content || (busy && i === msgs.length - 1 ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null)}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Habla con el agente de $${symbol}…`} maxLength={2000} />
            <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Enviar">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          <p className="mt-2 text-[10px] text-muted-foreground">Datos on-chain reales. Informativo, no es consejo financiero.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Idea opcional (ej. 'holders esperando la graduación')" maxLength={300} />
            <Button type="button" onClick={genMeme} disabled={memeBusy}>
              {memeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              <span className="ml-1">Generar</span>
            </Button>
          </div>
          {memeErr && <p className="text-xs text-destructive">{memeErr}</p>}
          {meme && (
            <>
              <canvas ref={canvasRef} className="w-full max-w-md rounded-xl border border-border" />
              <p className="text-xs text-muted-foreground">{meme.caption}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={shareX}><Share2 className="mr-1 h-3 w-3" /> X</Button>
                <Button type="button" variant="outline" size="sm" onClick={shareTg}><Send className="mr-1 h-3 w-3" /> Telegram</Button>
                <Button type="button" variant="outline" size="sm" onClick={download}><Download className="mr-1 h-3 w-3" /> Descargar</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
