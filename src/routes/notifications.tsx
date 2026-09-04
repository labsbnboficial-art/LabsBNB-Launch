import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useAuth } from "@/lib/auth";
import { Bell, CheckCircle2, Rocket, TrendingUp, Coins } from "lucide-react";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — LabsBNB Launchpad" },
      { name: "description", content: "Your alerts: token graduations, verified launches, price movements." },
      { property: "og:title", content: "Notifications — LabsBNB Launchpad" },
      { property: "og:description", content: "Alerts and updates from LabsBNB." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationsPage,
});

type NotifPayload = {
  title?: string;
  body?: string;
  href?: string;
  kind?: "graduation" | "verified" | "price" | "system";
  read?: boolean;
};

function iconFor(kind?: string) {
  switch (kind) {
    case "graduation": return <Rocket className="h-4 w-4 text-accent" />;
    case "verified": return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "price": return <TrendingUp className="h-4 w-4 text-primary" />;
    default: return <Coins className="h-4 w-4 text-muted-foreground" />;
  }
}

function NotificationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth", search: { redirect: "/notifications" } }); }, [loading, user, navigate]);

  const q = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity")
        .select("*")
        .eq("kind", "notification")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["notifications"] }),
      qc.invalidateQueries({ queryKey: ["notif-count"] }),
    ]);
  }

  async function markRead(id: string, payload: NotifPayload) {
    if (payload.read) return;
    const { error } = await supabase.from("activity").update({ payload: { ...payload, read: true } as never }).eq("id", id);
    if (error) {
      toast.error("No se pudo marcar la notificación como leída.");
      console.error("[NOTIF_READ]", error);
      return;
    }
    await refresh();
  }

  async function markAllRead() {
    const unread = (q.data ?? []).filter((n) => !((n.payload ?? {}) as NotifPayload).read);
    if (unread.length === 0) return;
    await Promise.all(
      unread.map((n) =>
        supabase
          .from("activity")
          .update({ payload: { ...((n.payload ?? {}) as NotifPayload), read: true } as never })
          .eq("id", n.id),
      ),
    );
    await refresh();
  }

  if (loading || !user) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl brand-gradient grid place-items-center glow-primary">
              <Bell className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-3xl font-bold">Notifications</h1>
          </div>
          <button onClick={markAllRead} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">Mark all read</button>
        </div>

        <div className="glass-strong rounded-2xl divide-y divide-white/5">
          {(q.data ?? []).map((n) => {
            const p = (n.payload ?? {}) as NotifPayload;
            const unread = !p.read;
            const inner = (
              <div className={`flex items-start gap-3 px-5 py-4 ${unread ? "bg-primary/5" : ""}`}>
                <div className="mt-0.5">{iconFor(p.kind)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.title ?? "Update"}</div>
                  {p.body && <div className="text-xs text-muted-foreground mt-0.5">{p.body}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
                {unread && <span className="h-2 w-2 rounded-full bg-primary mt-2" />}
              </div>
            );
            return (
              <div key={n.id} onClick={() => markRead(n.id, p)} className="cursor-pointer">
                {p.href ? <Link to={p.href as never}>{inner}</Link> : inner}
              </div>
            );
          })}
          {(q.data ?? []).length === 0 && (
            <div className="py-14 text-center text-sm text-muted-foreground">You're all caught up.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
