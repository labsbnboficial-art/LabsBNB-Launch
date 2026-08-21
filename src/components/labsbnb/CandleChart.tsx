// Professional trading-terminal candlestick chart (TradingView Lightweight Charts).
//
// Data source is untouched: real on-chain Trade(...) events aggregated by
// buildCandles(events, timeframeSeconds) in curve-events.ts.
//
// Key fix vs the previous version: the visible logical range no longer forces a
// minimum span of MIN_VISIBLE slots. With only a handful of candles that padded
// the window with empty slots and produced the "CANDLE   CANDLE   CANDLE" gaps.
// Now the viewport auto-fits the real data range and barSpacing is derived from
// the available pixel width so bars always sit shoulder to shoulder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2, Minimize2, Move, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { createLastPriceLine, createPriceLine } from "./chart-lines";
import type { Candle, TradeEvent } from "@/lib/web3/curve-events";

type Props = {
  candles: Candle[];
  visibleCount: number;
  onVisibleCountChange: (n: number) => void;
  quoteSymbol?: string;
  /** Real all-time-high price (BNB per token) drawn as a gold reference line. */
  athPrice?: number | null;
  /** Raw on-chain trades (same source as the candles) for markers + volume flow. */
  trades?: TradeEvent[];
  /** Seconds per candle of the active timeframe (used to bucket trades). */
  bucketSeconds?: number;
  /** Timeframe selector rendered inside the chart toolbar. */
  timeframe?: string;
  timeframes?: ReadonlyArray<{ id: string; label: string }>;
  onTimeframeChange?: (id: string) => void;
};


const UP = "#22c55e";
const DOWN = "#ef4444";
const MIN_VISIBLE = 4;
const MAX_VISIBLE = 600;
const DEFAULT_VISIBLE = 100;
/**
 * Hard cap on the width of a single bar slot. Terminals like DEXTools never
 * grow a candle past ~10px no matter how few bars exist; without this cap a
 * 3-candle chart turns into three giant rectangles.
 */
const MAX_BAR_SPACING = 11;
const MIN_BAR_SPACING = 0.6;
/** Minimum number of slots the viewport pretends to have, so a handful of
 * candles stays compact (right-aligned) instead of being stretched. */
const MIN_SLOTS_DESKTOP = 60;
const MIN_SLOTS_MOBILE = 34;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function priceFormat(candles: Candle[]) {
  const min = candles.reduce((acc, c) => (c.low > 0 && c.low < acc ? c.low : acc), Number.POSITIVE_INFINITY);
  const ref = Number.isFinite(min) ? min : 1;
  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(ref)) + 3));
  return { type: "price" as const, precision: digits, minMove: Number(`1e-${digits}`) };
}

/**
 * Smart price label: keeps significant digits for sub-gwei prices, trims
 * trailing zeros and never falls back to unreadable scientific notation.
 */
function smartPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  let out: string;
  if (abs >= 1000) out = v.toFixed(2);
  else if (abs >= 1) out = v.toFixed(4);
  else {
    const lead = Math.ceil(-Math.log10(abs)); // zeros after the dot
    out = v.toFixed(Math.min(18, lead + 4));
  }
  return out.includes(".") ? out.replace(/0+$/, "").replace(/\.$/, "") : out;
}

const COUNT_PRESETS = [50, 100, 200, 500];


export function CandleChart({
  candles,
  visibleCount,
  onVisibleCountChange,
  quoteSymbol = "BNB",
  athPrice = null,
  trades,
  bucketSeconds,
  timeframe,
  timeframes,
  onTimeframeChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const renderedRef = useRef<{ tf: string; times: number[] } | null>(null);
  const rangeCb = useRef(onVisibleCountChange);
  rangeCb.current = onVisibleCountChange;
  const programmatic = useRef(false);

  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<Candle | null>(null);
  const [hostWidth, setHostWidth] = useState(0);


  const data = useMemo(() => {
    // Lightweight Charts requires strictly ascending, unique timestamps.
    const seen = new Set<number>();
    return candles
      .map((c) => ({ ...c, t: Math.floor(c.time / 1000) }))
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)))
      .sort((a, b) => a.t - b.t);
  }, [candles]);

  /**
   * Buy/sell split per candle, derived from the same on-chain Trade events that
   * produced the candles (no extra source, no mock data).
   */
  const flow = useMemo(() => {
    const map = new Map<number, { buy: number; sell: number }>();
    if (!trades?.length || !bucketSeconds) return map;
    for (const e of trades) {
      const t = Math.floor(e.timestamp / bucketSeconds) * bucketSeconds;
      const vol = Number(e.amountBnb) / 1e18;
      if (!Number.isFinite(vol)) continue;
      const cur = map.get(t) ?? { buy: 0, sell: 0 };
      if (e.isBuy) cur.buy += vol;
      else cur.sell += vol;
      map.set(t, cur);
    }
    return map;
  }, [trades, bucketSeconds]);

  /** Discreet BUY/SELL markers: only the biggest trades, so the chart breathes. */
  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!trades?.length || !bucketSeconds || data.length === 0) return [];
    const valid = new Set(data.map((c) => c.t));
    const top = [...trades]
      .filter((e) => valid.has(Math.floor(e.timestamp / bucketSeconds) * bucketSeconds))
      .sort((a, b) => (a.amountBnb === b.amountBnb ? 0 : a.amountBnb > b.amountBnb ? -1 : 1))
      .slice(0, 30);
    return top
      .map((e) => ({
        time: (Math.floor(e.timestamp / bucketSeconds) * bucketSeconds) as UTCTimestamp,
        position: e.isBuy ? ("belowBar" as const) : ("aboveBar" as const),
        color: e.isBuy ? UP : DOWN,
        shape: e.isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
        size: 0.7,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
  }, [trades, bucketSeconds, data]);



  // Create the chart once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      // Pin the locale: some environments report exotic tags (en-US@posix)
      // that make Intl throw inside the chart's time-axis formatter.
      localization: { locale: "en-US", priceFormatter: smartPrice },
      width: host.clientWidth || 600,
      height: host.clientHeight || 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226,232,240,0.62)",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      // Subtle terminal grid: readable, never competing with the candles.
      grid: {
        vertLines: { color: "rgba(148,163,184,0.04)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.12)",
        scaleMargins: { top: 0.06, bottom: 0.24 },
        entireTextOnly: true,
        ticksVisible: false,
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 6,
        minBarSpacing: MIN_BAR_SPACING,
        lockVisibleTimeRangeOnResize: true,
        ticksVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },

      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(56,189,248,0.45)",
          width: 1,
          style: 3,
          labelBackgroundColor: "#0ea5e9",
        },
        horzLine: {
          color: "rgba(56,189,248,0.45)",
          width: 1,
          style: 3,
          labelBackgroundColor: "#0ea5e9",
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: "rgba(34,197,94,0.85)",
      wickDownColor: "rgba(239,68,68,0.85)",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      // Ignore ranges we set ourselves, otherwise the auto-fit effect and this
      // listener would ping-pong and shrink the preset the user chose.
      if (!range || programmatic.current) return;
      const n = Math.round(range.to - range.from);
      if (Number.isFinite(n) && n >= MIN_VISIBLE && n <= MAX_VISIBLE) rangeCb.current(n);
    });

    // ResizeObserver instead of `autoSize`: the chart lives inside flex/grid
    // containers where the library's own sizing observer misses the first pass.
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        chart.applyOptions({ width: w, height: h });
        setHostWidth(w);
      }
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
        color: c.close >= c.open ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
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

  // Current-price line (last close), refreshed on every data update.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const last = data.at(-1);
    const line = createLastPriceLine(series, last?.close ?? null);
    return () => {
      if (line) {
        try {
          series.removePriceLine(line);
        } catch {
          /* series already disposed */
        }
      }
    };
  }, [data]);

  // Auto-fit: candles keep a terminal-grade density. The slot width is derived
  // from the width divided by a *floor* of slots, so 2 candles look like 2 thin
  // candles anchored to the right edge instead of two giant blocks.
  const applyFit = useCallback(
    (target: number) => {
      const chart = chartRef.current;
      if (!chart || data.length === 0) return;
      const width = hostWidth || hostRef.current?.clientWidth || 600;
      const minSlots = width < 520 ? MIN_SLOTS_MOBILE : MIN_SLOTS_DESKTOP;
      const span = clamp(Math.min(target, data.length), 1, MAX_VISIBLE);
      // Slots the viewport pretends to hold — never fewer than minSlots.
      const slots = Math.max(span, Math.min(minSlots, target));
      const spacing = clamp(width / (slots + 2), MIN_BAR_SPACING, MAX_BAR_SPACING);
      const rightPad = Math.max(1, Math.round(spacing >= 6 ? 2 : 3));
      chart.timeScale().applyOptions({ barSpacing: spacing, rightOffset: rightPad });
      const to = data.length - 1 + rightPad;
      // Show `slots` worth of window so sparse data breathes to the left
      // instead of being stretched across the canvas.
      const window_ = Math.max(slots, span);
      programmatic.current = true;
      chart.timeScale().setVisibleLogicalRange({ from: to - window_, to });
      window.setTimeout(() => {
        programmatic.current = false;
      }, 60);
    },
    [data.length, hostWidth],
  );


  useEffect(() => {
    applyFit(visibleCount);
  }, [applyFit, visibleCount, full]);

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
  const fmt = (v: number | undefined) => (v == null || !Number.isFinite(v) ? "—" : smartPrice(v));


  const btn =
    "rounded-md border border-white/10 bg-white/[0.04] p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground active:scale-95";

  return (
    <div
      ref={wrapRef}
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col gap-2 bg-background/98 p-3 backdrop-blur-xl sm:p-4"
          : "relative flex flex-col gap-2"
      }
    >
      {/* OHLC readout — follows the hovered candle, falls back to the last one */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground">
        <span className={`tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
          <span className="opacity-60">O</span> {fmt(shown?.open)} <span className="opacity-60">H</span> {fmt(shown?.high)}{" "}
          <span className="opacity-60">L</span> {fmt(shown?.low)} <span className="opacity-60">C</span> {fmt(shown?.close)}
        </span>
        <span className="tabular-nums">
          <span className="opacity-60">Vol</span> {shown ? shown.volume.toFixed(4) : "—"} {quoteSymbol}
        </span>
        <span className="tabular-nums">
          <span className="opacity-60">Trades</span> {shown ? shown.trades : "—"}
        </span>
        <span className="hidden tabular-nums opacity-70 sm:inline">
          {shown ? new Date(shown.time).toLocaleString() : ""}
        </span>
      </div>

      {/* Compact toolbar — presets collapse away on small screens */}
      <div className="flex items-center gap-1 overflow-x-auto">
        <div className="hidden items-center gap-1 sm:flex">
          {COUNT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onVisibleCountChange(n)}
              className={`rounded-md border px-2 py-1 text-[10px] font-mono transition-colors ${
                visibleCount === n
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-mono tabular-nums text-muted-foreground">
          {Math.min(visibleCount, data.length || visibleCount)} velas
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onVisibleCountChange(Math.max(MIN_VISIBLE, Math.round(visibleCount * 0.7)))}
            className={btn}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onVisibleCountChange(Math.min(MAX_VISIBLE, Math.round(visibleCount * 1.4) + 1))}
            className={btn}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Ajustar al rango con datos"
            title="Fit"
            onClick={() => {
              const n = clamp(data.length || DEFAULT_VISIBLE, MIN_VISIBLE, MAX_VISIBLE);
              onVisibleCountChange(n);
              applyFit(n);
            }}
            className={`${btn} hidden sm:block`}
          >
            <Move className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => {
              onVisibleCountChange(DEFAULT_VISIBLE);
              applyFit(DEFAULT_VISIBLE);
            }}
            className={`${btn} hidden sm:block`}

          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"}
            className={btn}
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className={full ? "relative min-h-0 flex-1" : "relative"}>
        <div
          ref={hostRef}
          className={
            full
              ? "h-full w-full"
              : "h-[300px] w-full max-w-full overflow-hidden transition-[height] duration-200 sm:h-[380px] lg:h-[440px]"
          }
        />
        {data.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-sm font-medium text-foreground/80">No trading data available yet</span>
            <span className="text-xs text-muted-foreground">
              El gráfico se construye con operaciones reales on-chain. Aparecerá automáticamente con el primer trade.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
