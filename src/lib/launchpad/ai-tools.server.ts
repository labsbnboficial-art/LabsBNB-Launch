// LabsBNB AI Copilot — data tools.
//
// The model never receives the database or a dump of the chain: it calls these
// tools, which read the exact same normalized market data layer the UI uses.
// Every value returned here is on-chain. Unknown values are returned as null
// so the model can answer "no data" instead of inventing one.
import { getTokenMarketData, listMarketTokens, selectors } from "./market-data";
import { fetchTradeEvents, buildCandles, TIMEFRAMES } from "@/lib/web3/curve-events";
import { fetchTopHolders } from "@/lib/web3/holders";
import type { TokenMarketData } from "./types";

const compact = (t: TokenMarketData) => ({
  address: t.address,
  name: t.name,
  symbol: t.symbol,
  price: t.price,
  marketCap: t.marketCap,
  volume24h: t.volume24h,
  priceChange24h: t.priceChange24h,
  holders: t.holders,
  liquidity: t.liquidity,
  bondingProgress: t.bondingProgress,
  graduationStatus: t.graduationStatus,
  image: t.image,
});

async function curveOf(address: string) {
  const data = await getTokenMarketData(address);
  return data?.curve ?? null;
}

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "getTokenData",
      description:
        "Full on-chain market snapshot of one token: price, market cap, liquidity, 24h volume, holders, ATH, buys/sells and bonding curve progress.",
      parameters: {
        type: "object",
        properties: { address: { type: "string", description: "Token contract address (0x…)" } },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTokenCandles",
      description: "OHLCV candles built from the token's real Trade events for a timeframe.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string" },
          timeframe: { type: "string", description: "1m, 5m, 15m, 30m, 1h, 4h or 1d" },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTokenTrades",
      description: "Most recent real trades (buy/sell, amounts, price, wallet, tx hash).",
      parameters: {
        type: "object",
        properties: { address: { type: "string" }, limit: { type: "number" } },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTokenHolders",
      description: "Top holders of a token read from on-chain transfer history.",
      parameters: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listTokens",
      description:
        "Launchpad market list. sort: volume | marketCap | gainers | holders | graduating | new. Use for trending, top volume, top gainers, new launches or tokens near graduation.",
      parameters: {
        type: "object",
        properties: { sort: { type: "string" }, limit: { type: "number" } },
        required: ["sort"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getKingOfTheHill",
      description: "Current King of the Hill token (same criterion used by the Home page).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getMarketOverview",
      description: "Aggregate launchpad stats: token count, total 24h volume, total market cap, graduated count.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "getTokenData": {
      const data = await getTokenMarketData(String(args.address ?? ""), { withHistory: true });
      return data ?? { error: "Token not found on the LabsBNB factory." };
    }
    case "getTokenCandles": {
      const curve = await curveOf(String(args.address ?? ""));
      if (!curve) return { error: "No bonding curve for this token." };
      const tf =
        TIMEFRAMES.find((t) => t.id === String(args.timeframe ?? "15m")) ??
        TIMEFRAMES.find((t) => t.id === "15m")!;
      const events = await fetchTradeEvents(curve);
      const candles = buildCandles(events, tf.seconds).slice(-60);
      return { timeframe: tf.id, count: candles.length, candles };
    }
    case "getTokenTrades": {
      const curve = await curveOf(String(args.address ?? ""));
      if (!curve) return { error: "No bonding curve for this token." };
      const limit = Math.min(Number(args.limit ?? 20) || 20, 50);
      const events = await fetchTradeEvents(curve);
      return events.slice(-limit).reverse().map((e) => ({
        type: e.isBuy ? "buy" : "sell",
        trader: e.trader,
        bnb: Number(e.amountBnb) / 1e18,
        tokens: Number(e.amountTokens) / 1e18,
        price: Number(e.price) / 1e18,
        time: new Date(e.timestamp * 1000).toISOString(),
        tx: e.txHash,
      }));
    }
    case "getTokenHolders": {
      const address = String(args.address ?? "");
      const result = await fetchTopHolders(address as `0x${string}`, 10);
      return result;
    }
    case "listTokens": {
      const limit = Math.min(Number(args.limit ?? 5) || 5, 10);
      const all = await listMarketTokens(24);
      const sort = String(args.sort ?? "volume");
      const sorted =
        sort === "marketCap"
          ? selectors.topMarketCap(all)
          : sort === "gainers"
            ? selectors.topGainers(all)
            : sort === "holders"
              ? selectors.topHolders(all)
              : sort === "graduating"
                ? selectors.graduating(all)
                : sort === "new"
                  ? all
                  : selectors.topVolume(all);
      return sorted.slice(0, limit).map(compact);
    }
    case "getKingOfTheHill": {
      const king = selectors.king(await listMarketTokens(24));
      return king ? compact(king) : { error: "No token qualifies as King of the Hill yet." };
    }
    case "getMarketOverview": {
      const all = await listMarketTokens(24);
      const sum = (f: (t: TokenMarketData) => string | null) =>
        all.reduce((acc, t) => acc + (f(t) ? Number(f(t)) : 0), 0);
      return {
        tokens: all.length,
        totalVolume24hBnb: sum((t) => t.volume24h),
        totalMarketCapBnb: sum((t) => t.marketCap),
        graduated: all.filter((t) => t.graduationStatus === "graduated").length,
        bonding: all.filter((t) => t.graduationStatus === "bonding").length,
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
