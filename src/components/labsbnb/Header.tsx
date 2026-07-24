import { Link } from "@tanstack/react-router";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wallet, Rocket, Trophy, User, Shield, Globe } from "lucide-react";

function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
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
          <Link to="/ranking" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            <span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />{t("nav.ranking")}</span>
          </Link>
          {user && (
            <Link to="/profile" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{t("nav.profile")}</span>
            </Link>
          )}
          <Link to="/admin" className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition">
            <span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />{t("nav.admin")}</span>
          </Link>
        </nav>

        <div className="flex items-center gap-2">
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isPending}
                  className="h-9 brand-gradient text-primary-foreground font-medium hover:opacity-90 glow-primary"
                >
                  <Wallet className="h-3.5 w-3.5 mr-1.5" />
                  {t("nav.connect")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong">
                {connectors.map((c) => (
                  <DropdownMenuItem
                    key={c.uid}
                    onClick={() => connect({ connector: c })}
                    className="cursor-pointer"
                  >
                    <Wallet className="h-3.5 w-3.5 mr-2" />
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
