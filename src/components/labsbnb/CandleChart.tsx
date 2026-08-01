import { useEffect, useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle } from "@/lib/web3/curve-events";

type ShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Candle;
};

/** Draws one candle: wick spans low→high (the bar area), body spans open→close. */
function CandleShape(props: ShapeProps) {
  const { x = 0, y = 0, width = 0, payload } = props;
  if (!payload) return null;
  const height = Math.max(props.height ?? 0, 2);
  const { open, close, high, low } = payload;
  const span = high - low || high || 1;
  const priceToY = (p: number) => y + ((high - p) / span) * height;
  const up = close >= open;
  // Design tokens are oklch values, so they must be used raw (not wrapped in hsl()).
  const color = up ? "var(--success)" : "var(--destructive)";
  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyH = Math.max(2, bodyBottom - bodyTop);
  const cx = x + width / 2;
  const bw = Math.max(1.5, Math.min(width, width * 0.8));
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} opacity={up ? 0.95 : 0.9} rx={1} />
    </g>
  );
}

export function CandleChart({
  candles,
  gap = "1%",
  barSize = 5,
  onZoom,
}: {
  candles: Candle[];
  /** Horizontal separation between candles (smaller = tighter). */
  gap?: string;
  /** Maximum candle width in px. */
  barSize?: number;
  /** Wheel / pinch zoom: +1 zoom in (fewer candles), -1 zoom out. */
  onZoom?: (direction: 1 | -1) => void;
}) {
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!zoomRef.current) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (Math.abs(dy) < 1) return;
      zoomRef.current(dy < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const data = useMemo(
    () =>
      candles.map((c) => ({
        ...c,
        // A flat candle (single trade) would give a zero-height bar: pad it slightly.
        hl: [c.low, c.high === c.low ? c.high * 1.0005 || c.high + 1e-12 : c.high] as [number, number],
      })),
    [candles],
  );
  const domain = useMemo<[number | "auto", number | "auto"]>(() => {
    if (!candles.length) return ["auto", "auto"];
    const lo = Math.min(...candles.map((c) => c.low));
    const hi = Math.max(...candles.map((c) => c.high));
    const pad = (hi - lo) * 0.12 || hi * 0.05 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }, [candles]);



  return (
    <div className="space-y-2" ref={wrapRef}>
      <div className="h-72 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barCategoryGap={gap} barGap={0} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>

            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" minTickGap={14} />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              width={78}
              domain={domain}
              tickFormatter={(v: number) => v.toPrecision(3)}
            />
            <Tooltip
              cursor={{ fill: "color-mix(in oklch, var(--muted) 20%, transparent)" }}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                fontSize: 12,
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const c = payload[0].payload as Candle;
                return (
                  <div className="glass-strong rounded-xl p-3 text-xs font-mono space-y-0.5">
                    <div className="text-muted-foreground">{c.label}</div>
                    <div>O {c.open.toPrecision(5)}</div>
                    <div>H {c.high.toPrecision(5)}</div>
                    <div>L {c.low.toPrecision(5)}</div>
                    <div>C {c.close.toPrecision(5)}</div>
                    <div className="text-muted-foreground">Vol {c.volume.toFixed(4)} BNB · {c.trades} trades</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="hl" shape={<CandleShape />} isAnimationActive={false} maxBarSize={barSize} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap={gap} barGap={0} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" hide />
            {/* Same axis width as the price chart so bars line up with candles. */}
            <YAxis width={78} tick={false} axisLine={false} tickLine={false} />

            <Bar dataKey="volume" isAnimationActive={false}>
              {data.map((c) => (
                <Cell
                  key={c.time}
                  fill={c.close >= c.open ? "var(--success)" : "var(--destructive)"}
                  opacity={0.5}
                />
              ))}

            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
