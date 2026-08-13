// Admin → Telegram Signals. Status of the bot/channel plus a real connection test
// that publishes a message to @LabsBNBSignals. No secrets ever reach this component.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getTelegramStatus, testTelegram } from "@/lib/telegram.functions";
import { Send, RefreshCw, Loader2, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <Badge
        variant="outline"
        className={
          ok === undefined
            ? "border-white/15 text-foreground"
            : ok
              ? "border-emerald-400/30 text-emerald-300"
              : "border-rose-400/30 text-rose-300"
        }
      >
        {ok === undefined ? "" : ok ? "🟢 " : "🔴 "}
        {value}
      </Badge>
    </div>
  );
}

export function AdminTelegramTab({ csrf }: { csrf: string }) {
  const statusFn = useServerFn(getTelegramStatus);
  const testFn = useServerFn(testTelegram);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useQuery({
    queryKey: ["admin-telegram-status"],
    queryFn: () => statusFn({ data: { csrf } }),
  });

  const s = q.data;

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const r = await testFn({ data: { csrf } });
      setResult({ ok: true, text: `Telegram connection successful. Mensaje #${r.messageId} publicado en ${r.chatTitle}.` });
      toast.success("Telegram connection successful.");
      q.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido.";
      setResult({ ok: false, text: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">Telegram Signals</h3>
            <p className="text-xs text-muted-foreground">
              Publicación de señales en el canal oficial. El token del bot vive solo en el backend.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        <div className="grid gap-3">
          <Row
            label="Telegram Bot"
            value={s?.configured ? (s.bot ?? "Configured") : "Not configured"}
            ok={s?.configured}
          />
          <Row label="Channel" value={s?.channel ?? "@LabsBNBSignals"} />
          <Row
            label="Connection"
            value={s?.connected ? `Connected${s.chatTitle ? ` — ${s.chatTitle}` : ""}` : "Disconnected"}
            ok={s?.connected}
          />
        </div>

        {s && !s.configured && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Falta el secret <code className="font-mono">TELEGRAM_BOT_TOKEN</code> en el backend. Añádelo desde el gestor
            de secrets del proyecto (nunca en el código).
          </p>
        )}

        {s?.configured && !s.connected && s.error && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/5 p-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {s.error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={runTest} disabled={testing || !s?.configured}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            TEST TELEGRAM CONNECTION
          </Button>
          <a
            href="https://t.me/LabsBNBSignals"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            Abrir canal <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {result && (
          <p
            className={`mt-4 flex items-start gap-2 rounded-2xl border p-3 text-xs ${
              result.ok
                ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"
                : "border-rose-400/25 bg-rose-400/5 text-rose-200"
            }`}
          >
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {result.text}
          </p>
        )}
      </div>
    </div>
  );
}
