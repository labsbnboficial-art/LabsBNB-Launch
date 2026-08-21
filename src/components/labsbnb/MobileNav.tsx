// Mobile side drawer: the only navigation surface on phones.
//
// Every entry points at a route that actually exists in src/routes — no
// placeholder destinations. Desktop navigation is untouched; this component is
// hidden from `md:` up.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Globe,
  Menu,
  PlusCircle,
  Rocket,
  Search,
  Sparkles,
  Target,
  Trophy,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { RiskDisclaimer } from "@/components/labsbnb/RiskDisclaimer";

type Item = { to: string; label: string; icon: LucideIcon; exact?: boolean; authOnly?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Trade",
    items: [
      { to: "/", label: "Launchpad", icon: Rocket, exact: true },
      { to: "/create", label: "Create Token", icon: PlusCircle },
      { to: "/ranking", label: "Rankings", icon: Trophy },
    ],
  },
  {
    title: "Engage",
    items: [
      { to: "/missions", label: "Missions", icon: Sparkles },
      { to: "/campaigns/new", label: "Nueva campaña", icon: Target },
    ],
  },
  {
    title: "Analytics",
    items: [{ to: "/explorer", label: "Explorer", icon: Search }],
  },
  {
    title: "Account",
    items: [
      { to: "/profile", label: "Profile", icon: User, authOnly: true },
      { to: "/notifications", label: "Notifications", icon: Bell, authOnly: true },
    ],
  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { locale, setLocale } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Close on route change and lock body scroll while the drawer is open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActive = (item: Item) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-controls="mobile-drawer"
        className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open &&
        createPortal(
          // Portal to <body>: the header uses backdrop-blur, which creates a
          // containing block and would clip a `fixed` drawer to the header box.
          <div className="fixed inset-0 z-[110]">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm animate-fade-in"
          />
          <aside
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navegación"
            className="fixed inset-y-0 right-0 flex w-[86%] max-w-xs flex-col border-l border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl motion-safe:animate-slide-in-right"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="font-display text-sm font-bold tracking-tight">
                Labs<span className="text-gradient">BNB</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {GROUPS.map((group) => {
                const items = group.items.filter((i) => !i.authOnly || user);
                if (items.length === 0) return null;
                return (
                  <div key={group.title} className="mb-4">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                      {group.title}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const active = isActive(item);
                        const Icon = item.icon;
                        return (
                          <li key={item.to}>
                            <Link
                              to={item.to}
                              onClick={() => setOpen(false)}
                              aria-current={active ? "page" : undefined}
                              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition active:scale-[0.99] ${
                                active
                                  ? "border border-primary/30 bg-primary/10 text-foreground"
                                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                              }`}
                            >
                              <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} />
                              <span className="min-w-0 truncate">{item.label}</span>
                              {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-white/5 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between gap-2">
                <RiskDisclaimer />
                <button
                  type="button"
                  onClick={() => setLocale(locale === "es" ? "en" : "es")}
                  aria-label="Cambiar idioma"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs uppercase tracking-wider text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {locale === "es" ? "ES" : "EN"}
                </button>
              </div>
            </div>
          </aside>
          </div>,
          document.body,
        )}
    </div>
  );
}
