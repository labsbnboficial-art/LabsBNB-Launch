import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { z } from "zod";
import { formatEther } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLaunchpadConfig } from "@/lib/launchpad-config";
import { createCampaign } from "@/lib/missions.functions";
import { CAMPAIGN_DURATIONS, REWARD_CURRENCIES, TASK_CATALOG, type TaskType } from "@/lib/xp";
import { Rocket, Sparkles } from "lucide-react";

export const Route = createFileRoute("/campaigns/new")({
  validateSearch: (s: Record<string, unknown>) => z.object({ token: z.string().uuid().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "Crear campaña de crecimiento — LabsBNB" },
      { name: "description", content: "Lanza una campaña de crecimiento para tu token: define presupuesto, duración, tareas y recompensas para la comunidad de LabsBNB." },
      { property: "og:title", content: "Crear campaña de crecimiento — LabsBNB" },
      { property: "og:description", content: "Define presupuesto, tareas y recompensas para impulsar tu token." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewCampaignPage,
});

type TaskDraft = { type: TaskType; enabled: boolean; required: boolean; xp: number; reward: number; params: Record<string, string> };

function NewCampaignPage() {
  const { token: tokenId } = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { address } = useAccount();
  const { data: cfg } = useLaunchpadConfig();
  const createFn = useServerFn(createCampaign);

  const [title, setTitle] = useState("Campaña de crecimiento");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("token");
  const [budget, setBudget] = useState("0");
  const [perTask, setPerTask] = useState("0");
  const [maxParticipants, setMaxParticipants] = useState("100");
  const [duration, setDuration] = useState(72);
  const [feeTx, setFeeTx] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TaskDraft[]>(() =>
    TASK_CATALOG.map((t) => ({ type: t.type, enabled: ["follow_labsbnb", "buy_min", "favorite"].includes(t.type), required: true, xp: t.xp, reward: 0, params: {} })),
  );

  const myTokensQ = useQuery({
    queryKey: ["my-tokens-campaign", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tokens").select("id,name,ticker").eq("creator_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [selectedToken, setSelectedToken] = useState<string | undefined>(tokenId);
  const activeToken = selectedToken ?? tokenId ?? myTokensQ.data?.[0]?.id;

  const feeWei = useMemo(() => {
    try { return BigInt(cfg?.campaign_fee_bnb ?? "0"); } catch { return 0n; }
  }, [cfg?.campaign_fee_bnb]);

  const { sendTransactionAsync } = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({ hash: feeTx });
  const paid = feeWei === 0n || receipt.isSuccess;

  async function payFee() {
    if (!address) { toast.error("Conecta tu wallet"); return; }
    try {
      const hash = await sendTransactionAsync({ to: cfg!.admin_wallet as `0x${string}`, value: feeWei, chainId: 97 });
      setFeeTx(hash);
      toast.success("Pago enviado, esperando confirmación…");
    } catch (e) { toast.error((e as Error).message); }
  }

  async function submit() {
    if (!user) { toast.error("Inicia sesión primero"); navigate({ to: "/auth", search: { redirect: "/campaigns/new" } }); return; }
    if (!activeToken) { toast.error("Selecciona un token"); return; }
    const selected = tasks.filter((t) => t.enabled);
    if (!selected.length) { toast.error("Selecciona al menos una tarea"); return; }
    if (!paid) { toast.error("Paga la comisión de campaña primero"); return; }
    setBusy(true);
    try {
      const r = await createFn({
        data: {
          tokenId: activeToken,
          title: title.trim(),
          description: description.trim() || undefined,
          rewardCurrency: currency as "token",
          rewardBudget: Number(budget) || 0,
          rewardPerTask: Number(perTask) || 0,
          maxParticipants: Number(maxParticipants) || 100,
          durationHours: duration,
          feeTxHash: feeTx,
          tasks: selected.map((t) => ({
            type: t.type,
            required: t.required,
            xp: Number(t.xp) || 10,
            reward: Number(t.reward) || 0,
            params: Object.fromEntries(Object.entries(t.params).filter(([, v]) => v !== "")),
          })),
        },
      });
      toast.success("Campaña creada");
      navigate({ to: "/campaigns/$id", params: { id: r.id } });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
            <Rocket className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Campaña de crecimiento</h1>
            <p className="text-sm text-muted-foreground">Define presupuesto, tareas y recompensas para tu comunidad.</p>
          </div>
        </div>

        <div className="mt-8 glass-strong rounded-3xl p-6 space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Token</Label>
            <select
              value={activeToken ?? ""}
              onChange={(e) => setSelectedToken(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              <option value="">Selecciona…</option>
              {(myTokensQ.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name} (${t.ticker})</option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Duración</Label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                {CAMPAIGN_DURATIONS.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Descripción</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Moneda de recompensa</Label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                {REWARD_CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Presupuesto total</Label>
              <Input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Recompensa por tarea</Label>
              <Input type="number" min="0" value={perTask} onChange={(e) => setPerTask(e.target.value)} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Máx. participantes</Label>
              <Input type="number" min="1" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} className="mt-2" />
            </div>
          </div>
        </div>

        <div className="mt-6 glass-strong rounded-3xl p-6">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />Tareas</h2>
          <div className="mt-4 space-y-3">
            {TASK_CATALOG.map((spec) => {
              const draft = tasks.find((t) => t.type === spec.type)!;
              const update = (patch: Partial<TaskDraft>) =>
                setTasks((prev) => prev.map((t) => (t.type === spec.type ? { ...t, ...patch } : t)));
              return (
                <div key={spec.type} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">{spec.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {spec.group} · {spec.verification === "auto" ? "verificación automática" : "revisión manual"}
                      </div>
                    </div>
                    <Switch checked={draft.enabled} onCheckedChange={(c) => update({ enabled: c })} />
                  </div>
                  {draft.enabled && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">XP</Label>
                        <Input type="number" min="0" value={draft.xp} onChange={(e) => update({ xp: Number(e.target.value) })} className="mt-1 h-9" />
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Recompensa</Label>
                        <Input type="number" min="0" value={draft.reward} onChange={(e) => update({ reward: Number(e.target.value) })} className="mt-1 h-9" />
                      </div>
                      <div className="flex items-end gap-2">
                        <Switch checked={draft.required} onCheckedChange={(c) => update({ required: c })} />
                        <span className="text-xs text-muted-foreground pb-2">Obligatoria</span>
                      </div>
                      {spec.type === "buy_min" && (
                        <div className="sm:col-span-3">
                          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Compra mínima (BNB)</Label>
                          <Input type="number" min="0" step="0.001" value={draft.params.min_bnb ?? ""} onChange={(e) => update({ params: { ...draft.params, min_bnb: e.target.value } })} className="mt-1 h-9" />
                        </div>
                      )}
                      {spec.type === "hold" && (
                        <div className="sm:col-span-3">
                          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Horas de hold</Label>
                          <Input type="number" min="1" value={draft.params.hours ?? ""} onChange={(e) => update({ params: { ...draft.params, hours: e.target.value } })} className="mt-1 h-9" />
                        </div>
                      )}
                      {spec.type === "referral" && (
                        <div className="sm:col-span-3">
                          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Referidos requeridos</Label>
                          <Input type="number" min="1" value={draft.params.count ?? ""} onChange={(e) => update({ params: { ...draft.params, count: e.target.value } })} className="mt-1 h-9" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 glass-strong rounded-3xl p-6">
          <h2 className="font-display text-lg font-semibold">Comisión de campaña</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {feeWei === 0n
              ? "Sin comisión configurada. Puedes publicar la campaña directamente."
              : `Se paga ${formatEther(feeWei)} BNB a la wallet admin para activar la campaña.`}
          </p>
          {feeWei > 0n && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={payFee} disabled={!!feeTx && !receipt.isError}>
                {receipt.isSuccess ? "Pagado ✓" : feeTx ? "Confirmando…" : `Pagar ${formatEther(feeWei)} BNB`}
              </Button>
              {feeTx && <span className="font-mono text-[11px] text-muted-foreground break-all">{feeTx}</span>}
            </div>
          )}
        </div>

        <Button onClick={submit} disabled={busy || !paid} className="mt-6 w-full brand-gradient text-primary-foreground glow-primary">
          {busy ? "Publicando…" : "Publicar campaña"}
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Presupuesto estimado: {budget || 0} {currency} · {Number(perTask) || 0} por tarea · máx. {maxParticipants} participantes
        </p>
      </div>
    </AppShell>
  );
}
