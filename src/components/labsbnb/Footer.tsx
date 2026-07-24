import { useI18n } from "@/lib/i18n";

const ECOSYSTEM = [
  { key: "Wallet", href: "#" },
  { key: "Swap", href: "#" },
  { key: "Burn Portal", href: "#" },
  { key: "NFT Marketplace", href: "#" },
  { key: "Staking", href: "#" },
  { key: "Casino", href: "#" },
  { key: "NFT Game", href: "#" },
  { key: "Explorer", href: "#" },
];

export function Footer() {
  const { t } = useI18n();
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ECOSYSTEM.map((e) => (
                <a
                  key={e.key}
                  href={e.href}
                  className="text-sm text-muted-foreground hover:text-accent transition"
                >
                  {e.key}
                </a>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Network</div>
            <div className="text-sm text-muted-foreground">BNB Smart Chain</div>
            <div className="mt-1 text-xs font-mono text-accent">Chain ID 56</div>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-white/5 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} LabsBNB</span>
          <span className="font-mono">v1.0 · Phase 1</span>
        </div>
      </div>
    </footer>
  );
}
