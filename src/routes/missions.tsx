import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/labsbnb/AppShell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listMissions, listCampaigns, claimMission, getMyMissionState, getXpLeaderboard } from "@/lib/missions.functions";
import { LEVELS, levelFor, levelProgress, nextLevel } from "@/lib/xp";
import { Sparkles, Trophy, Target, Gift, Clock } from "lucide-react";

export const Route = createFileRoute("/missions")({
  head: () => ({
    meta: [
      { title: "Labs Missions — misiones y recompensas de LabsBNB" },
      { name: "description", content: "Completa misiones diarias, semanales y campañas de proyectos para ganar XP, subir de nivel y desbloquear recompensas en LabsBNB." },
      { property: "og:title", content: "Labs Missions — misiones y recompensas de LabsBNB" },
      { property: "og:description", content: "Gana XP, sube de nivel y desbloquea recompensas completando misiones en el ecosistema LabsBNB." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MissionsPage,
});

type CampaignCard = {
  id: string; title: string; description: string | null; reward_currency: string;
  reward_per_task: number; max_participants: number; ends_at: string | null; status: string;
  token: { name: string; ticker: string; logo_url: string | null } | null;
};

type BoardRow = {
  user_id: string; xp: number;
  profile: { username: string | null; wallet_address: string | null } | null;
};

const TABS = [
  { key: "daily", label: "Diarias" },
  { key: "weekly", label: "Semanales" },
  { key: "event", label: "Eventos" },
  { key: "campaigns", label: "Campañas patrocinadas" },
] as const;

function MissionsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("daily");
  const qc = useQueryClient();

  const missionsFn = useServerFn(listMissions);
  const campaignsFn = useServerFn(listCampaigns);
  const stateFn = useServerFn(getMyMissionState);
  const boardFn = useServerFn(getXpLeaderboard);
  const claimFn = useServerFn(claimMission);

  const missionsQ = useQuery({ queryKey: ["missions"], queryFn: () => missionsFn() });
  const campaignsQ = useQuery({ queryKey: ["campaigns", "all"], queryFn: () => campaignsFn({ data: {} }) });
  const stateQ = useQuery({ queryKey: ["mission-state", user?.id], enabled: !!user, queryFn: () => stateFn() });
  const boardQ = useQuery({ queryKey: ["xp-board"], queryFn: () => boardFn() });

  const xp = stateQ.data?.xpTotal ?? 0;
  const level = levelFor(xp);
  const next = nextLevel(xp);

  async function claim(id: string) {
    if (!user) { toast.error("Inicia sesión para reclamar XP"); return; }
    try {
      const r = await claimFn({ data: { missionId: id } });
      toast[r.already ? "info" : "success"](r.already ? "Ya reclamada en este periodo" : `+${r.xp} XP`);
      qc.invalidateQueries({ queryKey: ["mission-state"] });
      qc.invalidateQueries({ queryKey: ["xp-board"] });
    } catch (e) { toast.error((e as Error).message); }
  }

  const missions = missionsQ.data?.missions ?? [];
  const schemaReady = missionsQ.data?.schemaReady !== false;
  const visible = missions.filter((m: { scope: string }) => m.scope === tab || (tab === "event" && m.scope === "sponsored"));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Labs Missions</h1>
            <p className="text-sm text-muted-foreground">Completa misiones, gana XP y sube de nivel en todo el ecosistema.</p>
          </div>
        </div>

        {!schemaReady && (
          <div className="mt-6 glass-strong rounded-2xl p-5 text-sm text-muted-foreground">
            Labs Missions aún no está inicializado en la base de datos. Aplica <code className="font-mono">docs/SQL_MISSIONS.md</code> en el editor SQL.
          </div>
        )}

        {/* Nivel del usuario */}
        <div className="mt-8 glass-strong rounded-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{level.emoji}</span>
              <div>
                <div className="font-display text-xl font-bold">{level.label}</div>
                <div className="text-xs text-muted-foreground">{xp.toLocaleString()} XP{next ? ` · faltan ${(next.min - xp).toLocaleString()} XP para ${next.label}` : " · nivel máximo"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {level.perks.map((p) => (
                <span key={p} className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-muted-foreground">{p}</span>
              ))}
            </div>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full brand-gradient" style={{ width: `${levelProgress(xp)}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {LEVELS.map((l) => (
              <div key={l.key} className={`rounded-xl border border-white/5 p-3 text-center ${l.key === level.key ? "bg-white/10" : "bg-white/[0.02]"}`}>
                <div className="text-lg">{l.emoji}</div>
                <div className="text-xs font-medium">{l.label}</div>
                <div className="text-[10px] text-muted-foreground">{l.min.toLocaleString()} XP</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-8 flex flex-wrap gap-2">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`rounded-full px-4 py-2 text-sm transition ${tab === tb.key ? "brand-gradient text-primary-foreground" : "bg-white/5 text-muted-foreground hover:text-foreground"}`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {tab === "campaigns" ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {(campaignsQ.data?.campaigns ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no hay campañas activas.</p>
            )}
            {((campaignsQ.data?.campaigns ?? []) as unknown as CampaignCard[]).map((c) => (
              <Link key={c.id} to="/campaigns/$id" params={{ id: c.id }} className="glass-strong rounded-2xl p-5 hover:bg-white/[0.06] transition">
                <div className="flex items-center gap-3">
                  {c.token?.logo_url ? (
                    <img src={c.token.logo_url} alt={c.token.name} className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-white/5 grid place-items-center"><Target className="h-4 w-4" /></div>
                  )}
                  <div>
                    <div className="font-semibold">{c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.token ? `$${c.token.ticker}` : "LabsBNB"} · {c.status}</div>
                  </div>
                </div>
                {c.description && <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{c.description}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Gift className="h-3 w-3" />{c.reward_per_task} {c.reward_currency}</span>
                  <span className="inline-flex items-center gap-1"><Trophy className="h-3 w-3" />{c.max_participants} plazas</span>
                  {c.ends_at && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(c.ends_at).toLocaleDateString()}</span>}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {visible.length === 0 && <p className="text-sm text-muted-foreground">No hay misiones en esta categoría todavía.</p>}
            {visible.map((m: { id: string; title: string; description: string | null; xp: number; reward_text: string | null }) => (
              <div key={m.id} className="glass-strong rounded-2xl p-5 flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold">{m.title}</div>
                  {m.description && <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>}
                  <div className="mt-2 text-xs text-accent">+{m.xp} XP{m.reward_text ? ` · ${m.reward_text}` : ""}</div>
                </div>
                <Button size="sm" onClick={() => claim(m.id)} className="brand-gradient text-primary-foreground shrink-0">Reclamar</Button>
              </div>
            ))}
          </div>
        )}

        {/* Leaderboard */}
        <div className="mt-10 glass-strong rounded-3xl p-6">
          <h2 className="font-display text-lg font-semibold">Top XP</h2>
          <div className="mt-4 divide-y divide-white/5">
            {(boardQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay XP registrado.</p>}
            {((boardQ.data ?? []) as unknown as BoardRow[]).map((r, i) => {
              const lv = levelFor(r.xp);
              return (
                <div key={r.user_id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="w-6 text-muted-foreground">{i + 1}</span>
                    <span>{lv.emoji}</span>
                    <span className="font-mono text-xs">{r.profile?.username || (r.profile?.wallet_address ? `${r.profile.wallet_address.slice(0, 6)}…${r.profile.wallet_address.slice(-4)}` : "anon")}</span>
                  </span>
                  <span className="text-accent">{r.xp.toLocaleString()} XP</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
