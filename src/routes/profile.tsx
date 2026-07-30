import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/labsbnb/AppShell";
import { useAuth } from "@/lib/auth";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { User, Wallet, Award, Rocket, TrendingUp, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "My profile — LabsBNB Launchpad" },
      { name: "description", content: "Your tokens, favorites, reputation and activity on the LabsBNB Launchpad." },
      { property: "og:title", content: "My profile — LabsBNB Launchpad" },
      { property: "og:description", content: "Your tokens and activity on LabsBNB." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

type Reputation = {
  tokens_created: number;
  tokens_graduated: number;
  total_volume_bnb: string | number;
  unique_traders: number;
};

function repTier(score: number): { label: string; color: string } {
  if (score >= 500) return { label: "Diamond", color: "text-cyan-300" };
  if (score >= 200) return { label: "Gold", color: "text-yellow-300" };
  if (score >= 50)  return { label: "Silver", color: "text-slate-200" };
  if (score >= 10)  return { label: "Bronze", color: "text-amber-500" };
  return { label: "Rookie", color: "text-muted-foreground" };
}

function ProfilePage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const { address } = useAccount();
  const navigate = useNavigate();

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth", search: { redirect: "/profile" } }); }, [loading, user, navigate]);

  const tokensQ = useQuery({
    queryKey: ["my-tokens", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tokens").select("id,name,ticker,logo_url,contract_address,status,created_at").eq("creator_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const favsQ = useQuery({
    queryKey: ["my-favs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("favorites").select("token_id, tokens(id,name,ticker,logo_url,contract_address)").eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const repQ = useQuery<Reputation | null>({
    queryKey: ["my-reputation", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("creator_reputation" as never).select("*").eq("user_id", user!.id).maybeSingle();
      return (data as Reputation | null) ?? null;
    },
  });

  if (loading || !user) return <AppShell><div className="p-12 text-center text-muted-foreground">…</div></AppShell>;

  const rep = repQ.data;
  const volBnb = rep ? Number(rep.total_volume_bnb) / 1e18 : 0;
  const score = rep ? (rep.tokens_created * 5 + rep.tokens_graduated * 20 + volBnb * 2 + rep.unique_traders) : 0;
  const tier = repTier(score);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-12">
        <div className="glass-strong rounded-3xl p-6 flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl brand-gradient grid place-items-center glow-primary">
            <User className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold truncate">{user.email}</h1>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-3 w-3" />
              {address ? <span className="font-mono">{address.slice(0, 10)}…{address.slice(-6)}</span> : <span>{t("profile.wallet")}: —</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5 justify-end"><Award className={`h-4 w-4 ${tier.color}`} /><span className={`font-display font-bold ${tier.color}`}>{tier.label}</span></div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Reputation · {Math.floor(score)}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox icon={<Rocket className="h-3.5 w-3.5" />} label="Tokens created" value={rep?.tokens_created ?? 0} />
          <StatBox icon={<Award className="h-3.5 w-3.5" />} label="Graduated" value={rep?.tokens_graduated ?? 0} />
          <StatBox icon={<TrendingUp className="h-3.5 w-3.5" />} label="Total volume" value={`${volBnb.toFixed(3)} BNB`} />
          <StatBox icon={<Users className="h-3.5 w-3.5" />} label="Unique traders" value={rep?.unique_traders ?? 0} />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <h3 className="font-display font-semibold mb-4">{t("profile.myTokens")}</h3>
            {tokensQ.data && tokensQ.data.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {tokensQ.data.map((tk) => (
                  <li key={tk.id}>
                    <Link to="/token/$address" params={{ address: tk.contract_address ?? tk.id }} className="flex items-center justify-between py-2 hover:text-accent">
                      <span>{tk.name} <span className="font-mono text-xs text-muted-foreground">${tk.ticker}</span></span>
                      <span className="text-[10px] uppercase text-muted-foreground">{tk.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No tokens yet. <Link to="/create" className="text-accent">Create one →</Link></p>
            )}
          </div>
          <div className="glass rounded-2xl p-6">
            <h3 className="font-display font-semibold mb-4">{t("profile.favorites")}</h3>
            {favsQ.data && favsQ.data.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {favsQ.data.map((f) => {
                  const tk = f.tokens as unknown as { id: string; name: string; ticker: string; contract_address: string | null } | null;
                  if (!tk) return null;
                  return (
                    <li key={f.token_id}>
                      <Link to="/token/$address" params={{ address: tk.contract_address ?? tk.id }} className="block py-2 hover:text-accent">
                        {tk.name} <span className="font-mono text-xs text-muted-foreground">${tk.ticker}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No favorites yet.</p>
            )}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/" }); }}>Sign out</Button>
        </div>
      </div>
    </AppShell>
  );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 font-display font-semibold">{value}</div>
    </div>
  );
}
