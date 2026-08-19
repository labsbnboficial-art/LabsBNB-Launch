import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getCampaign, joinCampaign, submitTask, listCampaignSubmissions, reviewSubmission, setCampaignStatus } from "@/lib/missions.functions";
import { taskSpec } from "@/lib/xp";
import { Target, Users, Gift, Clock } from "lucide-react";

export const Route = createFileRoute("/campaigns/$id")({
  head: () => ({
    meta: [
      { title: "Campaña de crecimiento — LabsBNB" },
      { name: "description", content: "Completa las tareas de esta campaña de crecimiento y gana XP y recompensas del proyecto en LabsBNB." },
      { property: "og:title", content: "Campaña de crecimiento — LabsBNB" },
      { property: "og:description", content: "Completa tareas, gana XP y recompensas del proyecto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignPage,
});

type Task = { id: string; type: string; label: string | null; required: boolean; xp: number; reward: number; verification: string; params: Record<string, unknown> };

function CampaignPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getCampaign);
  const joinFn = useServerFn(joinCampaign);
  const submitFn = useServerFn(submitTask);
  const statusFn = useServerFn(setCampaignStatus);

  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => getFn({ data: { id } }) });
  const campaign = q.data?.campaign as
    | { id: string; title: string; description: string | null; creator_id: string | null; status: string; reward_currency: string; reward_per_task: number; reward_budget: number; max_participants: number; ends_at: string | null }
    | undefined;
  const tasks = (q.data?.tasks ?? []) as unknown as Task[];
  const participants = (q.data?.participants ?? []) as unknown as { user_id: string; wallet_address: string | null; xp_earned: number; reward_earned: number }[];
  const isCreator = !!user && campaign?.creator_id === user.id;

  const [proofs, setProofs] = useState<Record<string, string>>({});

  async function join() {
    try { await joinFn({ data: { campaignId: id } }); toast.success("Te has unido a la campaña"); qc.invalidateQueries({ queryKey: ["campaign", id] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function send(task: Task) {
    if (!user) { toast.error("Inicia sesión primero"); return; }
    try {
      const r = await submitFn({ data: { taskId: task.id, proof: proofs[task.id] } });
      toast.success(r.status === "auto_verified" ? "Tarea verificada ✓" : "Enviada para revisión");
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      qc.invalidateQueries({ queryKey: ["mission-state"] });
    } catch (e) { toast.error((e as Error).message); }
  }

  if (q.isLoading) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;
  if (q.error || !campaign) return <AppShell><div className="p-12 text-center text-muted-foreground">Campaña no encontrada.</div></AppShell>;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-10">
        <div className="glass-strong rounded-3xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold">{campaign.title}</h1>
              {campaign.description && <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>}
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">{campaign.status}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Gift className="h-3 w-3" />{campaign.reward_per_task} {campaign.reward_currency} / tarea</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{participants.length}/{campaign.max_participants}</span>
            {campaign.ends_at && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />termina {new Date(campaign.ends_at).toLocaleString()}</span>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={join} className="brand-gradient text-primary-foreground">Participar</Button>
            {isCreator && campaign.status === "active" && (
              <Button variant="outline" onClick={async () => { await statusFn({ data: { id, status: "ended" } }); qc.invalidateQueries({ queryKey: ["campaign", id] }); }}>
                Finalizar campaña
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 glass-strong rounded-3xl p-6">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-accent" />Tareas</h2>
          <div className="mt-4 space-y-3">
            {tasks.map((t) => {
              const spec = taskSpec(t.type);
              const needsProof = spec && spec.proof !== "none" && t.verification !== "auto";
              const link = typeof t.params?.url === "string" ? (t.params.url as string) : "";
              return (
                <div key={t.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{t.label || spec?.label || t.type}</div>
                      <div className="text-[11px] text-muted-foreground">
                        +{t.xp} XP{t.reward ? ` · ${t.reward} ${campaign.reward_currency}` : ""} · {t.required ? "obligatoria" : "opcional"} · {t.verification === "auto" ? "automática" : "revisión manual"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="secondary">
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir
                          </Button>
                        </a>
                      )}
                      <Button size="sm" variant="outline" onClick={() => send(t)}>
                        {t.verification === "auto" ? "Verificar" : "Enviar"}
                      </Button>
                    </div>
                  </div>
                  {needsProof && (
                    <Input
                      value={proofs[t.id] ?? ""}
                      onChange={(e) => setProofs((p) => ({ ...p, [t.id]: e.target.value }))}
                      placeholder={spec?.proof === "url" ? "Enlace a tu publicación" : spec?.proof === "tx" ? "Hash de la transacción" : "Tu usuario"}
                      className="mt-3 h-9"
                      maxLength={500}
                    />
                  )}
                </div>
              );
            })}
            {!tasks.length && <p className="text-sm text-muted-foreground">Esta campaña aún no tiene tareas.</p>}
          </div>
        </div>


        <div className="mt-6 glass-strong rounded-3xl p-6">
          <h2 className="font-display text-lg font-semibold">Participantes</h2>
          <div className="mt-3 divide-y divide-white/5">
            {participants.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono text-xs">{p.wallet_address ? `${p.wallet_address.slice(0, 6)}…${p.wallet_address.slice(-4)}` : p.user_id.slice(0, 8)}</span>
                <span className="text-accent">{p.xp_earned} XP · {p.reward_earned} {campaign.reward_currency}</span>
              </div>
            ))}
            {!participants.length && <p className="text-sm text-muted-foreground">Todavía nadie participa.</p>}
          </div>
        </div>

        {isCreator && <CreatorReview campaignId={id} />}
      </div>
    </AppShell>
  );
}

function CreatorReview({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCampaignSubmissions);
  const reviewFn = useServerFn(reviewSubmission);
  const q = useQuery({ queryKey: ["campaign-subs", campaignId], queryFn: () => listFn({ data: { campaignId } }) });
  const subs = (q.data?.submissions ?? []) as unknown as { id: string; task_id: string; wallet_address: string | null; proof: string | null; status: string }[];
  const tasks = (q.data?.tasks ?? []) as unknown as { id: string; label: string | null; type: string }[];

  async function review(sid: string, approve: boolean) {
    try {
      await reviewFn({ data: { submissionId: sid, approve } });
      toast.success(approve ? "Aprobada" : "Rechazada");
      qc.invalidateQueries({ queryKey: ["campaign-subs", campaignId] });
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="mt-6 glass-strong rounded-3xl p-6">
      <h2 className="font-display text-lg font-semibold">Panel del creador — revisión de tareas</h2>
      <div className="mt-3 divide-y divide-white/5">
        {subs.map((s) => {
          const t = tasks.find((x) => x.id === s.task_id);
          return (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div>{t?.label || t?.type || "Tarea"}</div>
                <div className="text-[11px] text-muted-foreground break-all">
                  {s.wallet_address ?? "—"} · {s.status}{s.proof ? ` · ${s.proof}` : ""}
                </div>
              </div>
              {s.status === "pending" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => review(s.id, true)} className="brand-gradient text-primary-foreground">Aprobar</Button>
                  <Button size="sm" variant="outline" onClick={() => review(s.id, false)}>Rechazar</Button>
                </div>
              )}
            </div>
          );
        })}
        {!subs.length && <p className="text-sm text-muted-foreground">Sin envíos todavía.</p>}
      </div>
    </div>
  );
}
