import { useMemo } from "react";

/**
 * Ambient animated particles behind the whole app.
 * Purely decorative: fixed, non-interactive and CSS-animated (no rAF loop),
 * so it costs nothing on scroll and respects `prefers-reduced-motion`.
 */
export function ParticleField({ count = 28 }: { count?: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // Deterministic pseudo-random so SSR and client markup match.
        const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        return {
          id: i,
          left: r(1) * 100,
          top: r(2) * 100,
          size: 1.5 + r(3) * 3.5,
          dur: 14 + r(4) * 20,
          delay: -r(5) * 20,
          dx: (r(6) - 0.5) * 120,
          dy: -(30 + r(7) * 120),
          cyan: r(8) > 0.55,
        };
      }),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 hero-bg opacity-70" />
      <div className="absolute inset-0 grid-bg opacity-40" />
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full animate-particle blur-[0.5px]"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            background: p.cyan ? "var(--accent)" : "var(--primary)",
            boxShadow: `0 0 ${p.size * 4}px currentColor`,
            color: p.cyan ? "var(--accent)" : "var(--primary)",
            animationDelay: `${p.delay}s`,
            ["--dur" as string]: `${p.dur}s`,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
          }}
        />
      ))}
    </div>
  );
}
