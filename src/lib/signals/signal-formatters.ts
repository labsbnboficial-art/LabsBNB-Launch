import { explorerTxUrl } from "@/lib/web3/networks";
// Telegram message rendering for the Signal Engine.
// Pure functions: no network, no secrets. All dynamic content is HTML-escaped
// so a token name can never break the message layout or inject markup.
import { SIGNAL_LABELS, type SignalCandidate, type SignalType } from "./signal-types";

export const FALLBACK_SITE_URL = "https://labsbnb-launchpad.com";

export function siteUrl(configured?: unknown): string {
  const raw = typeof configured === "string" ? configured.trim() : "";
  if (!raw) return FALLBACK_SITE_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return FALLBACK_SITE_URL;
    // Telegram rejects inline-button URLs pointing at localhost/private hosts,
    // so a local dev origin must never leak into a published signal.
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)$/i.test(u.hostname)) return FALLBACK_SITE_URL;
    return u.origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}


export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const nf = (n: number, digits = 4) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    : "N/A";

export function bnb(value: unknown, digits = 4): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || !Number.isFinite(n)) return "N/A";
  return `${nf(n, digits)} BNB`;
}

export function pct(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || !Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${nf(n, digits)}%`;
}

export function num(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || !Number.isFinite(n)) return "N/A";
  return nf(n, 0);
}

export function shortAddress(address: unknown): string {
  const a = String(address ?? "");
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "N/A";
}

export function timeAgo(iso: unknown): string {
  const t = iso ? Date.parse(String(iso)) : NaN;
  if (!Number.isFinite(t)) return "N/A";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export type InlineButton = { text: string; url: string };

export type RenderedSignal = {
  text: string;
  buttons: InlineButton[][];
};

function tokenLinks(base: string, address: string): InlineButton[][] {
  const token = `${base}/token/${address}`;
  return [
    [
      { text: "📊 View Token", url: token },
      { text: "💱 Trade", url: `${token}?action=trade` },
    ],
    [{ text: "📈 Chart", url: `${token}?tab=chart` }],
  ];
}

const line = (emoji: string, label: string, value: string) => `${emoji} <b>${label}:</b> ${value}`;

const footer = "<i>LabsBNB Launchpad · BNB Smart Chain</i>";

/** Renders a candidate into the final Telegram HTML + inline keyboard. */
export function renderSignal(candidate: SignalCandidate, base: string): RenderedSignal {
  const d = candidate.data;
  const symbol = esc(d.symbol ?? "TOKEN");
  const head = (title: string) => `${title}\n\n<b>$${symbol}</b>`;
  const body: string[] = [];
  let title = `<b>${esc(SIGNAL_LABELS[candidate.type])}</b>`;

  switch (candidate.type) {
    case "NEW_TOKEN":
      title = "🚀 <b>NEW LABSBNB LAUNCH</b>";
      body.push(
        line("🏷", "Name", esc(d.name)),
        line("💎", "Market Cap", bnb(d.marketCap)),
        line("💧", "Liquidity", bnb(d.liquidity)),
        line("📊", "Bonding Curve", pct(d.bondingProgress, 1)),
        line("👥", "Holders", num(d.holders)),
        line("📈", "Volume", bnb(d.volume24h)),
        line("🕒", "Created", esc(d.createdAgo ?? "just now")),
      );
      break;
    case "KING_OF_THE_HILL":
      title = "👑 <b>KING OF THE HILL</b>";
      body.push(
        line("💎", "Market Cap", bnb(d.marketCap)),
        line("📈", "Volume", bnb(d.volume24h)),
        line("👥", "Holders", num(d.holders)),
        line("📊", "Bonding", pct(d.bondingProgress, 1)),
        line("⏱", "24H", pct(d.priceChange24h)),
      );
      break;
    case "VOLUME_SPIKE":
      title = "🔥 <b>VOLUME SPIKE</b>";
      body.push(
        line("📊", "Volume", bnb(d.windowVolume)),
        line("📈", "Increase", pct(d.increasePct, 0)),
        line("🕒", "Window", `${esc(d.windowMinutes)}m`),
        line("🔁", "Trades", num(d.trades)),
        line("💎", "Market Cap", bnb(d.marketCap)),
        line("👥", "Holders", num(d.holders)),
      );
      break;
    case "NEW_ATH":
      title = "🏆 <b>NEW ATH</b>";
      body.push(
        line("🚀", "New ATH", bnb(d.athPrice, 12)),
        line("📉", "Previous", d.previousAth == null ? "first recorded ATH" : bnb(d.previousAth, 12)),
        line("💎", "Market Cap", bnb(d.marketCap)),
        line("📈", "Volume", bnb(d.volume24h)),
        line("🕒", "Time", esc(d.athTime)),
      );
      break;
    case "BONDING_PROGRESS":
      title = "📈 <b>BONDING CURVE ALERT</b>";
      body.push(
        line("📊", "Bonding Curve", pct(d.bondingProgress, 1)),
        line("↩️", "Previous milestone", d.previousMilestone == null ? "none" : `${esc(d.previousMilestone)}%`),
        line("⏳", "Remaining", bnb(d.bondingRemaining)),
        line("💎", "Market Cap", bnb(d.marketCap)),
      );
      break;
    case "GRADUATION":
      title = "🎓 <b>TOKEN GRADUATED</b>";
      body.push(
        "<i>The token has successfully completed the bonding curve.</i>",
        "",
        line("💎", "Final Market Cap", bnb(d.marketCap)),
        line("💧", "Liquidity", bnb(d.liquidity)),
        line("👥", "Holders", num(d.holders)),
      );
      break;
    case "WHALE_BUY":
    case "WHALE_SELL": {
      const isBuy = candidate.type === "WHALE_BUY";
      title = isBuy ? "🐋 <b>WHALE BUY</b>" : "🐳 <b>WHALE SELL</b>";
      body.push(
        line(isBuy ? "🟢" : "🔴", isBuy ? "Buy" : "Sell", bnb(d.amountBnb)),
        line("👛", "Wallet", `<code>${esc(shortAddress(d.wallet))}</code>`),
        line("💰", "Price", bnb(d.price, 12)),
        line("💎", "Market Cap", bnb(d.marketCap)),
        line("🕒", "Time", esc(d.tradeTime)),
      );
      break;
    }
  }

  const text = [head(title), "", ...body, "", footer].join("\n");
  const buttons = tokenLinks(base, String(candidate.tokenAddress));
  if (candidate.txHash) {
    buttons.push([
      { text: "🔎 Transaction", url: explorerTxUrl(candidate.txHash) },
    ]);
  }
  return { text, buttons };
}

/** Clearly-marked manual test signal — can never be mistaken for a real one. */
export function renderTestSignal(type: SignalType, base: string): RenderedSignal {
  return {
    text: [
      "🧪 <b>TEST SIGNAL</b>",
      "",
      `Signal type: <b>${esc(SIGNAL_LABELS[type])}</b>`,
      "",
      "<i>This is a manual test published from the LabsBNB admin panel.</i>",
      "<i>It does not represent real market activity.</i>",
      "",
      footer,
    ].join("\n"),
    buttons: [[{ text: "🌐 Open LabsBNB", url: base }]],
  };
}
