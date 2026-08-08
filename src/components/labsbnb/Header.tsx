import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { describeTxError } from "@/lib/web3/tx";
import { ACTIVE_CHAIN_ID } from "@/lib/web3/config";
import { Button } from "@/components/ui/button";
import { Wallet, Rocket, Trophy, User, Globe, Search, Bell, Sparkles } from "lucide-react";
import { RiskDisclaimer } from "@/components/labsbnb/RiskDisclaimer";

function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Wallet picker.
 *
 * Deliberately NOT a Radix dropdown: Radix locks `pointer-events: none` on
 * <body> while its menu unmounts, which swallowed every click inside the
 * WalletConnect QR modal (Chrome / Opera / Brave) and made the button look
 * dead. This plain menu closes first and connects on the next frame.
 */
function ConnectMenu() {
  const { t } = useI18n();
  const { connectAsync, connectors, isPending } = useConnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function pick(connectorId: string) {
    const connector = connectors.find((c) => c.uid === connectorId);
    if (!connector) return;
    setOpen(false);
    // Let React unmount the menu before the wallet modal takes over focus.
    await new Promise((r) => setTimeout(r, 0));
    // Safety net against any stale scroll-lock left by another overlay.
    document.body.style.pointerEvents = "";
    try {
      await connectAsync({ connector });
    } catch (e) {
      // Full technical detail to the console only; the toast stays generic.
      console.error("[labsbnb] connect failed", {
        connector: connector.name,
        id: connector.id,
        chainId: ACTIVE_CHAIN_ID,
        error: e,
        cause: (e as { cause?: unknown })?.cause,
      });
      const msg = describeTxError(e);
      if (!/cancelada|rejected/i.test(msg)) toast.error(msg);
    }
  }

  const label = (name: string) => {
    if (/walletconnect/i.test(name)) return "WalletConnect (Trust, Binance, OKX…)";
    if (/^injected$/i.test(name)) return "MetaMask / Wallet del navegador";
    return name;
  };


  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-9 brand-gradient text-primary-foreground font-medium hover:opacity-90 glow-primary"
      >
        <Wallet className="h-3.5 w-3.5 mr-1.5" />
        {isPending ? "…" : t("nav.connect")}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-[100] mt-2 w-64 overflow-hidden rounded-xl glass-strong p-1 animate-fade-in"
        >
          {connectors.map((c) => (
            <button
              key={c.uid}
              type="button"
              role="menuitem"
              onClick={() => void pick(c.uid)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-white/10 transition"
            >
              <Wallet className="h-3.5 w-3.5 text-accent" />
              {label(c.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { user } = useAuth();


  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 backdrop-blur-xl bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="relative h-9 w-9 rounded-xl brand-gradient grid place-items-center glow-primary transition-transform group-hover:scale-105">
            <Rocket className="h-4 w-4 text-background" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-lg font-bold tracking-tight">
              Labs<span className="text-gradient">BNB</span>
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Launchpad</span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link to="/" activeOptions={{ exact: true }} className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            {t("nav.launchpad")}
          </Link>
          <Link to="/create" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            {t("nav.create")}
          </Link>
          <Link to="/explorer" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            <span className="inline-flex items-center gap-1.5"><Search className="h-3.5 w-3.5" />Explorer</span>
          </Link>
          <Link to="/missions" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />Missions</span>
          </Link>
          <Link to="/ranking" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            <span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />{t("nav.ranking")}</span>
          </Link>
          {user && (
            <Link to="/profile" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{t("nav.profile")}</span>
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <RiskDisclaimer />
          {user && <NotifBell userId={user.id} />}
          <button
            onClick={() => setLocale(locale === "es" ? "en" : "es")}
            className="hidden sm:inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
            aria-label="Toggle language"
          >
            <Globe className="h-3.5 w-3.5" />
            {locale.toUpperCase()}
          </button>

          {isConnected ? (
            <Button variant="outline" onClick={() => disconnect()} className="h-9 border-white/10 bg-white/5 hover:bg-white/10 font-mono text-xs">
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              {shortAddr(address)}
            </Button>
          ) : (
            <ConnectMenu />
          )}

        </div>
      </div>
    </header>
  );
}

function NotifBell({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["notif-count", userId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity")
        .select("id,payload")
        .eq("kind", "notification")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []).filter((n) => {
        const p = (n.payload ?? {}) as { read?: boolean };
        return !p.read;
      }).length;
    },
  });
  const unread = q.data ?? 0;
  return (
    <Link to="/notifications" className="relative h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition" aria-label="Notifications">
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground grid place-items-center">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
