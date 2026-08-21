import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";

// Only real, existing routes — no placeholder `#` destinations.
const ECOSYSTEM: { label: string; to: string }[] = [
  { label: "Launchpad", to: "/" },
  { label: "Create Token", to: "/create" },
  { label: "Explorer", to: "/explorer" },
  { label: "Rankings", to: "/ranking" },
  { label: "Missions", to: "/missions" },
  { label: "Campaigns", to: "/campaigns/new" },
];

export function Footer() {
  const { t } = useI18n();
  const net = ACTIVE_NETWORK;
  return (
    <footer className="mt-24 border-t border-white/5 bg-background/60">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="font-display text-lg font-bold">
              Labs<span className="text-gradient">BNB</span> Launchpad
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t("footer.tagline")}</p>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Ecosystem</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {ECOSYSTEM.map((e) => (
                <Link
                  key={e.to}
                  to={e.to}
                  className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-accent transition"
                >
                  {e.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Network</div>
            <div className="text-sm text-muted-foreground">{net.name}</div>
            <div className="mt-1 text-xs font-mono text-accent">Chain ID {net.chainId}</div>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-white/5 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} LabsBNB</span>
          <span className="font-mono">{net.shortName}</span>
        </div>
      </div>
    </footer>
  );
}
