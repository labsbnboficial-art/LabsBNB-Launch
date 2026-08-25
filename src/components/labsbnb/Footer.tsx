import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { ACTIVE_NETWORK, explorerAddressUrl } from "@/lib/web3/networks";
import { ExternalLink } from "lucide-react";

// Only real, existing routes — no placeholder `#` destinations.
const ECOSYSTEM: { label: string; to: string }[] = [
  { label: "Launchpad", to: "/" },
  { label: "Create Token", to: "/create" },
  { label: "Explorer", to: "/explorer" },
  { label: "Rankings", to: "/ranking" },
  { label: "Missions", to: "/missions" },
  { label: "Campaigns", to: "/campaigns/new" },
];

const SOCIALS: { label: string; href: string }[] = [
  { label: "Telegram", href: "https://t.me/labsbnboficial" },
  { label: "X", href: "https://x.com/labsbnboficial" },
  { label: "Telegram Channel", href: "https://t.me/LabsBNBAdvertising" },
  { label: "Discord", href: "https://discord.com/invite/K8q2bJdF" },
  { label: "YouTube", href: "https://www.youtube.com/@LabsBnbOficial" },
];

const LABSBNB_TOKEN = {
  buy: "https://four.meme/en/token/0x7172429982f93c381f93fdd7e908bd96bc55ffff",
  contract: "0x7172429982f93c381f93fdd7e908bd96bc55ffff",
};

export function Footer() {
  const { t } = useI18n();
  const net = ACTIVE_NETWORK;
  return (
    <footer className="mt-24 border-t border-white/5 bg-background/60">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <div className="font-display text-lg font-bold">
              Labs<span className="text-gradient">BNB</span> Launchpad
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t("footer.tagline")}</p>
          </div>
          <div className="md:col-span-2 lg:col-span-2">
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
          <div className="lg:col-span-1">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Community</div>
            <div className="grid gap-1">
              {SOCIALS.map((s) => (
                <a
                  key={s.href}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition"
                >
                  {s.label}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              ))}
            </div>
          </div>
          <div className="lg:col-span-1">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">$LabsBNB</div>
            <div className="grid gap-1">
              <a
                href={LABSBNB_TOKEN.buy}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition"
              >
                Buy on four.meme
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
              <a
                href={explorerAddressUrl(LABSBNB_TOKEN.contract)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition"
                title={LABSBNB_TOKEN.contract}
              >
                <span className="truncate max-w-[10rem] font-mono text-xs">
                  {LABSBNB_TOKEN.contract.slice(0, 8)}…{LABSBNB_TOKEN.contract.slice(-6)}
                </span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </div>
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
