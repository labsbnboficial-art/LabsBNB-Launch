// Unified market data model for the LabsBNB launchpad.
//
// Every surface (Home, Token Detail, King of the Hill, Chart, AI Copilot)
// consumes this exact shape so a metric can never be computed two different
// ways in two different places.
//
// Convention: `null` means "unknown / not available" and the UI must render
// "N/A". `0` is only used when the chain really reports zero.

export type GraduationStatus = "bonding" | "graduated";

export type TokenMarketData = {
  address: `0x${string}`;
  curve: `0x${string}` | null;
  name: string;
  symbol: string;
  image: string | null;
  creator: string | null;

  /** BNB per token (18-decimals fixed point, as a decimal string). */
  price: string | null;
  marketCap: string | null;
  liquidity: string | null;
  volume24h: string | null;

  holders: number | null;
  priceChange24h: number | null; // percent

  athPrice: string | null;
  athDate: string | null; // ISO
  athMarketCap: string | null;
  distanceFromAth: number | null; // percent, negative = below ATH

  bondingProgress: number | null; // percent 0..100
  bondingRemaining: string | null; // BNB left to graduate
  graduationStatus: GraduationStatus;

  transactions24h: number | null;
  buys24h: number | null;
  sells24h: number | null;

  createdAt: string | null;
  updatedAt: string;
};

/** 18-decimals wei string/bigint → decimal number (display / AI only). */
export function toBnb(v: bigint | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "bigint" ? Number(v) / 1e18 : Number(v) / 1e18;
  return Number.isFinite(n) ? n : null;
}

export function fmtBnb(v: string | null, digits = 4): string {
  if (v == null) return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(digits);
  return n.toPrecision(4);
}
