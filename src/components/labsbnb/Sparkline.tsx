// Tiny trend line drawn from REAL closes (candles / trade prices).
// When there is not enough history it renders a neutral flat state instead of
// inventing a shape.
import { useMemo } from "react";

type Props = {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
};

export function Sparkline({ values, className = "", width = 120, height = 32 }: Props) {
  const path = useMemo(() => {
    const pts = values.filter((v) => Number.isFinite(v) && v > 0);
    if (pts.length < 2) return null;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || max || 1;
    const stepX = width / (pts.length - 1);
    return pts
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / span) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values, width, height]);

  if (!path) {
    return (
      <div
        className={`grid place-items-center text-[9px] uppercase tracking-widest text-muted-foreground/60 ${className}`}
        style={{ height }}
        aria-label="Sin histórico suficiente"
      >
        no data
      </div>
    );
  }

  const first = values.find((v) => v > 0) ?? 0;
  const last = [...values].reverse().find((v) => v > 0) ?? 0;
  const up = last >= first;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      role="img"
      aria-label="Tendencia de precio"
    >
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--success)" : "var(--destructive)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
