// Price-line helper kept apart so the chart component stays declarative.
import type { ISeriesApi, IPriceLine } from "lightweight-charts";

/** Draws the gold ATH reference line. Returns null when there is no real ATH. */
export function createPriceLine(
  series: ISeriesApi<"Candlestick">,
  price: number | null | undefined,
): IPriceLine | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  try {
    return series.createPriceLine({
      price,
      color: "#f5c451",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "ATH",
    });
  } catch {
    return null;
  }
}
