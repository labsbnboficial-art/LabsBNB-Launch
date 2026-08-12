// DEXTools-style candlestick chart powered by TradingView Lightweight Charts.
//
// Candles are built from real on-chain Trade(...) events (see curve-events.ts).
// Interactions: wheel zoom, horizontal drag, crosshair with OHLC + volume
// readout, autoscale, fullscreen. The visible candle count stays controlled so
// the page can keep the trades table in sync with the chart window.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { createPriceLine } from "./chart-lines";
import type { Candle } from "@/lib/web3/curve-events";

type Props = {
  candles: Candle[];
  visibleCount: number;
  onVisibleCountChange: (n: number) => void;
  quoteSymbol?: string;
  /** Real all-time-high price (BNB per token) drawn as a gold reference line. */
  athPrice?: number | null;
};

const UP = "#22c55e";
const DOWN = "#ef4444";
const MIN_VISIBLE = 15;
const MAX_VISIBLE = 600;

function priceFormat(candles: Candle[]) {
  const min = candles.reduce((acc, c) => (c.low > 0 && c.low < acc ? c.low : acc), Number.POSITIVE_INFINITY);
  const ref = Number.isFinite(min) ? min : 1;
  const digits = Math.min(10, Math.max(4, Math.ceil(-Math.log10(ref)) + 3));
  return { type: "price" as const, precision: digits, minMove: Number(`1e-${digits}`) };
}

const COUNT_PRESETS = [50, 100, 200, 500];

export function CandleChart({
  candles,
  visibleCount,
  onVisibleCountChange,
  quoteSymbol = "BNB",
  athPrice = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rangeCb = useRef(onVisibleCountChange);
  rangeCb.current = onVisibleCountChange;

  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<Candle | null>(null);

  const data = useMemo(() => {
    // Lightweight Charts requires strictly ascending, unique timestamps.
    const seen = new Set<number>();
    return candles
      .map((c) => ({ ...c, t: Math.floor(c.time / 1000) }))
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)))
      .sort((a, b) => a.t - b.t);
  }, [candles]);

  // Create the chart once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      // Pin the locale: some environments report exotic tags (en-US@posix)
      // that make Intl throw inside the chart's time-axis formatter.
      localization: { locale: "en-US" },
      width: host.clientWidth || 600,
      height: host.clientHeight || 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226,232,240,0.65)",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)", scaleMargins: { top: 0.08, bottom: 0.28 } },
      // Tight professional spacing: candles sit close together like a real
      // trading terminal instead of isolated blocks with wide gaps.
      timeScale: {
        borderColor: "rgba(148,163,184,0.15)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 5,
        minBarSpacing: 0.4,
      },

      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(56,189,248,0.5)", labelBackgroundColor: "#0ea5e9" },
        horzLine: { color: "rgba(56,189,248,0.5)", labelBackgroundColor: "#0ea5e9" },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const n = Math.round(range.to - range.from);
      if (Number.isFinite(n) && n >= MIN_VISIBLE && n <= MAX_VISIBLE) rangeCb.current(n);
    });

    // ResizeObserver instead of `autoSize`: the chart lives inside flex/grid
    // containers where the library's own sizing observer misses the first pass.
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(host);

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // Feed data (and keep the price precision aligned with sub-gwei prices).
  useEffect(() => {
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    if (!candleSeries || !volumeSeries) return;
    candleSeries.applyOptions({ priceFormat: priceFormat(candles) });
    candleSeries.setData(
      data.map((c) => ({ time: c.t as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    volumeSeries.setData(
      data.map((c) => ({
        time: c.t as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      })),
    );
  }, [data, candles]);

  // Gold ATH reference line — drawn only when a real ATH exists.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const line = createPriceLine(series, athPrice);
    return () => {
      if (line) {
        try {
          series.removePriceLine(line);
        } catch {
          /* series already disposed */
        }
      }
    };
  }, [athPrice, data.length]);

  // Crosshair legend (OHLC + volume of the hovered candle).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byTime = new Map(data.map((c) => [c.t, c]));
    const handler = (param: { time?: unknown }) => {
      const t = typeof param.time === "number" ? param.time : null;
      setHover(t != null ? (byTime.get(t) ?? null) : null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [data]);

  // Apply the controlled zoom level coming from the page (− / + buttons).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;
    // Keep the logical span equal to the requested candle count even when the
    // history is shorter, so bars stay thin instead of stretching to fill.
    const to = data.length + 2;
    chart.timeScale().setVisibleLogicalRange({ from: to - visibleCount, to });
  }, [visibleCount, data.length]);

  // Fullscreen without leaving React's control of the layout.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const last = data.at(-1) ?? null;
  const shown = hover ?? last;
  const up = shown ? shown.close >= shown.open : true;
  const fmt = (v: number | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : v >= 1 ? v.toFixed(4) : v.toPrecision(5);

  return (
    <div
      ref={wrapRef}
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col gap-2 bg-background/98 p-4 backdrop-blur"
          : "relative flex flex-col gap-2"
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
        <span className={up ? "text-emerald-400" : "text-red-400"}>
          O {fmt(shown?.open)} · H {fmt(shown?.high)} · L {fmt(shown?.low)} · C {fmt(shown?.close)}
        </span>
        <span>
          Vol {shown ? shown.volume.toFixed(4) : "—"} {quoteSymbol}
        </span>
        <span>Trades {shown ? shown.trades : "—"}</span>
        <span>{shown ? new Date(shown.time).toLocaleString() : ""}</span>
        <div className="ml-auto flex items-center gap-1">
          {COUNT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onVisibleCountChange(n)}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                visibleCount === n
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-white/10 bg-white/5 hover:text-foreground"
              }`}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onVisibleCountChange(Math.max(MIN_VISIBLE, Math.round(visibleCount * 0.7)))}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 hover:text-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onVisibleCountChange(Math.min(MAX_VISIBLE, Math.round(visibleCount * 1.4)))}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 hover:text-foreground"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => onVisibleCountChange(100)}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"}
          className="rounded-md border border-white/10 bg-white/5 p-1.5 text-muted-foreground hover:text-foreground"
        >
          {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="relative">
        <div ref={hostRef} className={full ? "min-h-0 flex-1" : "h-[360px] w-full"} />
        {data.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
            No hay suficientes operaciones para construir este intervalo.
          </div>
        )}
      </div>
    </div>
  );
}
