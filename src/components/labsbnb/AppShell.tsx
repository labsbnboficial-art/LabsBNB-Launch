import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ParticleField } from "./ParticleField";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ParticleField />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
