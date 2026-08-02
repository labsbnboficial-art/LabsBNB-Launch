import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/web3/curve-events";

/**
 * DEXTools-style candlestick chart rendered on a canvas.
 *
 * Canvas (instead of SVG/recharts) keeps the chart fluid with thousands of
 * candles: only the visible window is drawn, one frame per interaction.
 * Interactions: wheel zoom (anchored at the cursor), horizontal drag to pan,
 * two-finger pinch zoom + drag on touch, crosshair with OHLC readout.
 */

type Props = {
  /** Full candle history, oldest → newest. */
  candles: Candle[];
  /** Visible candle count (controlled). */
  visibleCount: number;
  onVisibleCountChange: (n: number) => void;
  /** Extra readout rendered in the legend row. */
  quoteSymbol?: string;
};

const MIN_VISIBLE = 15;
const MAX_VISIBLE = 600;
const VOLUME_RATIO = 0.22; // share of the plot height used by the volume pane
const PAD_RIGHT = 74; // price axis gutter
const PAD_BOTTOM = 22; // time axis gutter
const PAD_TOP = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cssVar(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function fmtPrice(v: number) {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toPrecision(4);
}

export function CandleChart({ candles, visibleCount, onVisibleCountChange, quoteSymbol = "BNB" }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 340 });
  /** Index (exclusive) of the right-most visible candle. */
  const [end, setEnd] = useState(candles.length);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const stuckRight = useRef(true);

  // Follow the live edge unless the user has panned back into history.
  useEffect(() => {
    if (stuckRight.current) setEnd(candles.length);
    else setEnd((e) => clamp(e, MIN_VISIBLE, candles.length));
  }, [candles.length]);

  const count = clamp(visibleCount, MIN_VISIBLE, Math.max(MIN_VISIBLE, MAX_VISIBLE));
  const safeEnd = clamp(end, Math.min(count, candles.length), candles.length);
  const start = Math.max(0, safeEnd - count);
  const view = useMemo(() => candles.slice(start, safeEnd), [candles, start, safeEnd]);

  // ---- responsive sizing -------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- drawing -----------------------------------------------------------
  const geom = useMemo(() => {
    const plotW = Math.max(10, size.w - PAD_RIGHT);
    const plotH = Math.max(10, size.h - PAD_BOTTOM - PAD_TOP);
    const priceH = plotH * (1 - VOLUME_RATIO);
    const volTop = PAD_TOP + priceH + 8;
    const volH = Math.max(8, plotH - priceH - 8);
    const step = plotW / Math.max(1, view.length);
    let lo = Infinity;
    let hi = -Infinity;
    let maxVol = 0;
    for (const c of view) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
    return { plotW, plotH, priceH, volTop, volH, step, lo, hi, maxVol };
  }, [size, view]);

  const priceToY = useCallback(
    (p: number) => PAD_TOP + ((geom.hi - p) / (geom.hi - geom.lo || 1)) * geom.priceH,
    [geom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || size.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const up = cssVar(wrap, "--success", "#22c55e");
    const down = cssVar(wrap, "--destructive", "#ef4444");
    const muted = cssVar(wrap, "--muted-foreground", "#8b94a7");
    const grid = "rgba(255,255,255,0.045)";
    const axis = "rgba(255,255,255,0.10)";
    const { plotW, priceH, volTop, volH, step, lo, hi, maxVol } = geom;

    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";

    // Horizontal grid + price scale
    const rows = 5;
    for (let i = 0; i <= rows; i++) {
      const y = PAD_TOP + (priceH / rows) * i;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(plotW, Math.round(y) + 0.5);
      ctx.stroke();
      const p = hi - ((hi - lo) / rows) * i;
      ctx.fillStyle = muted;
      ctx.textAlign = "left";
      ctx.fillText(fmtPrice(p), plotW + 6, y);
    }

    // Vertical grid + time scale
    const cols = Math.max(2, Math.min(8, Math.floor(plotW / 110)));
    ctx.textAlign = "center";
    for (let i = 0; i <= cols; i++) {
      const x = (plotW / cols) * i;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, PAD_TOP);
      ctx.lineTo(Math.round(x) + 0.5, volTop + volH);
      ctx.stroke();
      const idx = clamp(Math.floor((x / plotW) * view.length), 0, view.length - 1);
      const c = view[idx];
      if (c) {
        ctx.fillStyle = muted;
        ctx.fillText(c.label, clamp(x, 26, plotW - 26), size.h - PAD_BOTTOM / 2);
      }
    }

    // Axis separators
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(Math.round(plotW) + 0.5, 0);
    ctx.lineTo(Math.round(plotW) + 0.5, volTop + volH);
    ctx.stroke();

    // Candles — consecutive, 1px gutter only, exactly like DEXTools.
    const gutter = step > 6 ? 1 : step > 3 ? 0.5 : 0;
    const bodyW = Math.max(1, step - gutter * 2);
    const wickW = bodyW <= 2 ? 1 : Math.max(1, Math.round(bodyW * 0.16));
    for (let i = 0; i < view.length; i++) {
      const c = view[i];
      const x = i * step;
      const cx = x + step / 2;
      const bull = c.close >= c.open;
      const color = bull ? up : down;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      // wick
      ctx.fillRect(cx - wickW / 2, priceToY(c.high), wickW, Math.max(1, priceToY(c.low) - priceToY(c.high)));
      // body
      const yTop = priceToY(Math.max(c.open, c.close));
      const yBot = priceToY(Math.min(c.open, c.close));
      ctx.fillRect(x + gutter, yTop, bodyW, Math.max(1, yBot - yTop));
      // volume
      if (maxVol > 0) {
        ctx.globalAlpha = 0.42;
        const h = (c.volume / maxVol) * volH;
        ctx.fillRect(x + gutter, volTop + volH - h, bodyW, Math.max(1, h));
        ctx.globalAlpha = 1;
      }
    }

    // Last price marker
    const last = view[view.length - 1];
    if (last) {
      const y = priceToY(last.close);
      const color = last.close >= last.open ? up : down;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillRect(plotW + 1, y - 8, PAD_RIGHT - 2, 16);
      ctx.fillStyle = "#05070c";
      ctx.textAlign = "left";
      ctx.fillText(fmtPrice(last.close), plotW + 6, y);
    }

    // Crosshair
    if (hover && hover.i >= 0 && hover.i < view.length) {
      const cx = hover.i * step + step / 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, PAD_TOP);
      ctx.lineTo(Math.round(cx) + 0.5, volTop + volH);
      ctx.moveTo(0, Math.round(hover.y) + 0.5);
      ctx.lineTo(plotW, Math.round(hover.y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [size, geom, view, hover, priceToY]);

  // ---- interactions ------------------------------------------------------
  const zoomAt = useCallback(
    (factor: number, anchorRatio: number) => {
      const next = clamp(Math.round(count * factor), MIN_VISIBLE, MAX_VISIBLE);
      if (next === count) return;
      // keep the candle under the cursor in place
      const anchorIdx = start + anchorRatio * count;
      const newStart = Math.round(anchorIdx - anchorRatio * next);
      const newEnd = clamp(newStart + next, Math.min(next, candles.length), candles.length);
      stuckRight.current = newEnd >= candles.length;
      setEnd(newEnd);
      onVisibleCountChange(next);
    },
    [count, start, candles.length, onVisibleCountChange],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (Math.abs(dy) < 0.5) return;
      const rect = el.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width - PAD_RIGHT), 0, 1);
      zoomAt(Math.exp(dy * 0.0015), ratio);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Pointer drag (pan) + two-pointer pinch (zoom)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; end: number } | null>(null);
  const pinchRef = useRef<{ dist: number; count: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) dragRef.current = { x: e.clientX, end: safeEnd };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), count };
      dragRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 8) {
        const next = clamp(Math.round(pinchRef.current.count * (pinchRef.current.dist / dist)), MIN_VISIBLE, MAX_VISIBLE);
        if (next !== count) onVisibleCountChange(next);
      }
      return;
    }

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const shift = Math.round(dx / Math.max(1, geom.step));
      const next = clamp(dragRef.current.end - shift, Math.min(count, candles.length), candles.length);
      stuckRight.current = next >= candles.length;
      setEnd(next);
      return;
    }

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x > geom.plotW) return setHover(null);
    setHover({ i: clamp(Math.floor(x / Math.max(1, geom.step)), 0, view.length - 1), x, y });
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) dragRef.current = null;
  };

  const info = (hover && view[hover.i]) || view[view.length - 1];
  const change = info && info.open ? ((info.close - info.open) / info.open) * 100 : 0;

  return (
    <div className="select-none">
      {/* OHLC legend */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
        <span className="text-muted-foreground">{info?.label ?? "—"}</span>
        {info && (
          <>
            <span className="text-muted-foreground">
              O <span className="text-foreground">{fmtPrice(info.open)}</span>
            </span>
            <span className="text-muted-foreground">
              H <span className="text-success">{fmtPrice(info.high)}</span>
            </span>
            <span className="text-muted-foreground">
              L <span className="text-destructive">{fmtPrice(info.low)}</span>
            </span>
            <span className="text-muted-foreground">
              C <span className="text-foreground">{fmtPrice(info.close)}</span>
            </span>
            <span className={change >= 0 ? "text-success" : "text-destructive"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
            <span className="text-muted-foreground">
              Vol <span className="text-foreground">{info.volume.toFixed(4)}</span> {quoteSymbol}
            </span>
            <span className="text-muted-foreground">{info.trades} tx</span>
          </>
        )}
      </div>

      <div
        ref={wrapRef}
        className="relative h-[340px] w-full cursor-crosshair touch-none md:h-[400px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={(e) => {
          endPointer(e);
          setHover(null);
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
