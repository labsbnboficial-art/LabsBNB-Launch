import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ParticleField } from "./ParticleField";
import { NetworkGuard } from "./NetworkGuard";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ParticleField />
      <NetworkGuard />
      <Header />
      {/* pb-20 on phones keeps the floating AI button from covering the last
          row of controls; desktop keeps its original spacing. */}
      <main className="flex-1 pb-20 sm:pb-0">{children}</main>
      <Footer />
    </div>
  );
}
