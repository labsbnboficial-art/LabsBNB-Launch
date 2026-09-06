// Admin → 🏆 Creator Points → Creator Levels → 📜 Level History (Fase 2C.1).
// Read-only ledger of level milestones + server-side sync/backfill actions.
// Milestones are immutable: this panel never edits or deletes events.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLevelHistoryOverview, runLevelHistorySync } from "@/lib/levels.functions";

const fmt = (n: number) => n.toLocaleString("en-US");
const dt = (iso: string) => new Date(iso).toLocaleString("en-US");

type RunState = {
  creatorsScanned: number;
  milestonesDetected: number;
  milestonesInserted: number;
  alreadyExisting: number;
  errors: number;
  durationMs: number;
} | null;

export function AdminLevelHistoryPanel({ csrf }: { csrf: string }) {
  const overviewFn = useServerFn(getLevelHistoryOverview);
  const syncFn = useServerFn(runLevelHistorySync);

  const [creator, setCreator] = useState("");
  const [level, setLevel] = useState("");
  const [backfill, setBackfill] = useState<"all" | "backfill" | "live">("all");
  const [running, setRunning] = useState<"" | "sync" | "backfill">("");
  const [lastRun, setLastRun] = useState<RunState>(null);

  const filters = {
    csrf,
    ...(/^0x[a-fA-F0-9]{40}$/.test(creator.trim()) ? { creator: creator.trim().toLowerCase() } : {}),
    ...(level.trim() && Number.isFinite(Number(level)) ? { level: Number(level) } : {}),
    ...(backfill === "all" ? {} : { backfill: backfill === "backfill" }),
  };

  const q = useQuery({
    queryKey: ["admin-level-history", filters.creator ?? "", filters.level ?? "", backfill],
    queryFn: () => overviewFn({ data: filters }),
  });

  const run = async (mode: "sync" | "backfill") => {
    setRunning(mode);
    try {
      const res = await syncFn({ data: { csrf, backfill: mode === "backfill" } });
      setLastRun(res);
      toast.success(`Sync completado: ${res.milestonesInserted} milestones nuevos.`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar el sync.");
    } finally {
      setRunning("");
    }
  };

  const entries = q.data?.entries ?? [];

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold">📜 Level History</h3>
          <p className="text-[11px] text-muted-foreground">
            Milestones inmutables (append-only). No se pueden editar ni borrar desde la aplicación.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run("sync")} disabled={running !== ""}>
            {running === "sync" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run Level History Sync
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("backfill")} disabled={running !== ""}>
            {running === "backfill" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <History className="mr-2 h-4 w-4" />
            )}
            Backfill inicial
          </Button>
        </div>
      </div>

      {q.data && !q.data.storageReady && (
        <p className="mb-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          Tabla `creator_level_history` no disponible: ejecuta `docs/SQL_CREATOR_LEVEL_HISTORY.md` en Supabase.
          {q.data.storageError ? ` (${q.data.storageError})` : ""}
        </p>
      )}

      {lastRun && (
        <div className="mb-3 grid gap-1 rounded-xl bg-white/[0.03] p-3 text-[11px] md:grid-cols-3">
          <span>Creators scanned: {fmt(lastRun.creatorsScanned)}</span>
          <span>Milestones found: {fmt(lastRun.milestonesDetected)}</span>
          <span>Milestones inserted: {fmt(lastRun.milestonesInserted)}</span>
          <span>Already existing: {fmt(lastRun.alreadyExisting)}</span>
          <span>Errors: {fmt(lastRun.errors)}</span>
          <span>Execution time: {fmt(lastRun.durationMs)} ms</span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Input
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          placeholder="Creator 0x…"
          className="h-8 w-56 text-xs"
        />
        <Input
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          placeholder="Level"
          className="h-8 w-24 text-xs"
        />
        <select
          value={backfill}
          onChange={(e) => setBackfill(e.target.value as "all" | "backfill" | "live")}
          className="h-8 rounded-md border border-white/10 bg-white/5 px-2"
          aria-label="Origen del milestone"
        >
          <option value="all">Todos</option>
          <option value="live">Live</option>
          <option value="backfill">Backfill</option>
        </select>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
          Aplicar filtros
        </Button>
        <span className="self-center text-[11px] text-muted-foreground">
          Total milestones: {fmt(q.data?.total ?? 0)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[11px]">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Creator</th>
              <th className="p-2 text-left">Prev</th>
              <th className="p-2 text-left">New</th>
              <th className="p-2 text-left">Points</th>
              <th className="p-2 text-left">Timestamp</th>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-left">Fingerprint</th>
              <th className="p-2 text-left">Backfill</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-white/5">
                <td className="p-2 font-mono">
                  {e.creatorAddress.slice(0, 6)}…{e.creatorAddress.slice(-4)}
                </td>
                <td className="p-2">{e.previousLevel ?? "—"}</td>
                <td className="p-2">{e.newLevel}</td>
                <td className="p-2 font-mono tabular-nums">{fmt(e.pointsAtLevelUp)}</td>
                <td className="p-2">{dt(e.createdAt)}</td>
                <td className="p-2">{e.source}</td>
                <td className="p-2 font-mono">{e.fingerprint.slice(0, 10)}…</td>
                <td className="p-2">{e.backfill ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!entries.length && !q.isLoading && (
        <p className="mt-2 text-xs text-muted-foreground">Sin milestones para estos filtros.</p>
      )}
    </div>
  );
}
