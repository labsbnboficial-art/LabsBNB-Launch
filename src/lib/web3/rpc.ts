// Centralised RPC infrastructure for the launchpad.
//
// Public BNB testnet endpoints fail often and each in its own way:
//   - publicnode  → "no available nodes found for platform bsc-testnet-rpc"
//   - blastapi    → discontinued ("Blast API is no longer available")
//   - blockpi / omniatech → HTML error pages instead of JSON-RPC
//   - binance data-seeds → `-32005 limit exceeded` as soon as calls are batched
// Any of those surface in viem as "Requested resource not available" or
// "RPC endpoint returned too many errors". Only endpoints verified to answer
// eth_call / eth_getCode are listed here, and JSON-RPC batching is disabled
// because the public seeds reject batched payloads.
//
// PROVIDER SWAP WITHOUT CODE CHANGES
// ----------------------------------
// Every list below can be overridden through environment variables, so moving
// to a dedicated provider (QuickNode, Ankr, dRPC, NodeReal, ...) never requires
// touching contracts, components or `networks.ts`:
//
//   VITE_BSC_MAINNET_RPC_PRIMARY    single URL, always tried first
//   VITE_BSC_MAINNET_RPC_FALLBACKS  comma separated fallback URLs
//   VITE_BSC_MAINNET_LOG_RPC_URLS   comma separated endpoints for eth_getLogs
//   VITE_BSC_TESTNET_RPC_PRIMARY    (same three knobs for chain 97)
//   VITE_BSC_TESTNET_RPC_FALLBACKS
//   VITE_BSC_TESTNET_LOG_RPC_URLS
//
// The URLs are public client config, not secrets: if a provider issues a
// key-bearing URL, keep the whole URL in the env var and never hardcode it in
// the repo, never log it and never print it in the UI.
import { fallback, http, type Transport } from "viem";

import { runtimeRpcEnv } from "./runtime-rpc";

/**
 * Resolves an RPC env var, in priority order:
 *   1. build-time `import.meta.env.VITE_*`
 *   2. the runtime config injected by the server (Lovable Cloud secrets, which
 *      cannot be named `VITE_*`; see `runtime-rpc.ts`)
 *   3. `process.env` — canonical `VITE_*` name, then its non-prefixed alias
 */
function env(name: string): string | undefined {
  const viteEnv =
    typeof import.meta !== "undefined"
      ? (import.meta.env as Record<string, string | undefined> | undefined)
      : undefined;
  const fromVite = viteEnv?.[name];
  if (fromVite && fromVite.trim()) return fromVite.trim();

  const fromRuntime = runtimeRpcEnv(name);
  if (fromRuntime) return fromRuntime;

  const read = (key: string) =>
    typeof process !== "undefined" ? (process.env?.[key] as string | undefined) : undefined;
  const fromNode = read(name) ?? read(name.replace(/^VITE_/, ""));
  return fromNode && fromNode.trim() ? fromNode.trim() : undefined;
}


/** Splits a comma / whitespace separated env list into clean https URLs. */
function envList(name: string): string[] {
  const raw = env(name);
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

/** primary (env) → fallbacks (env) → defaults, deduped and order preserved. */
function buildList(primaryVar: string, fallbackVar: string, defaults: string[]): string[] {
  const primary = env(primaryVar);
  const merged = [...(primary ? [primary] : []), ...envList(fallbackVar), ...defaults];
  return [...new Set(merged)];
}

/** Public BNB Smart Chain Testnet (97) endpoints — verified for eth_call. */
const TESTNET_DEFAULTS: string[] = [
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://bsc-testnet.drpc.org",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-1-s2.binance.org:8545",
  "https://data-seed-prebsc-2-s2.binance.org:8545",
  "https://api.zan.top/bsc-testnet",
];

/** Public BNB Smart Chain Mainnet (56) endpoints. */
const MAINNET_DEFAULTS: string[] = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc.drpc.org",
];

/** Testnet endpoints that actually serve `eth_getLogs` for the event indexer. */
const TESTNET_LOG_DEFAULTS: string[] = [
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://bsc-testnet.drpc.org",
  "https://api.zan.top/bsc-testnet",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
];

/**
 * Mainnet log endpoints. The public data-seeds cap `eth_getLogs` hard, so a
 * dedicated provider MUST be supplied through `VITE_BSC_MAINNET_LOG_RPC_URLS`
 * before going live; until then these public nodes are used as a best effort.
 */
const MAINNET_LOG_DEFAULTS: string[] = [
  // PublicNode accepts the multi-thousand-block ranges used by the launchpad
  // indexer. Keep it before the heavily capped public data-seeds so a browser
  // does not need hundreds of 5-block requests just to reach a recent trade.
  "https://bsc.publicnode.com",
  "https://bsc-rpc.publicnode.com",
  "https://bsc.drpc.org",
  "https://bsc-dataseed.bnbchain.org",
];

/** BNB Smart Chain Testnet (97): [primary, ...fallbacks]. */
export const TESTNET_RPC_URLS: string[] = buildList(
  "VITE_BSC_TESTNET_RPC_PRIMARY",
  "VITE_BSC_TESTNET_RPC_FALLBACKS",
  TESTNET_DEFAULTS,
);

/** BNB Smart Chain Mainnet (56): [primary, ...fallbacks]. */
export const MAINNET_RPC_URLS: string[] = buildList(
  "VITE_BSC_MAINNET_RPC_PRIMARY",
  "VITE_BSC_MAINNET_RPC_FALLBACKS",
  MAINNET_DEFAULTS,
);

/** Testnet endpoints used exclusively for `eth_getLogs` (chart/trades/ATH). */
export const LOG_RPC_URLS: string[] = (() => {
  const fromEnv = envList("VITE_BSC_TESTNET_LOG_RPC_URLS");
  return fromEnv.length ? [...new Set(fromEnv)] : TESTNET_LOG_DEFAULTS;
})();

/**
 * Mainnet endpoints used for `eth_getLogs`.
 *
 * A dedicated LOG RPC is preferred, but it must never become a single point
 * of failure. Regular configured fallbacks (for example QuickNode) and the
 * public log-capable nodes remain available when the dedicated provider is
 * rate-limited, unreachable or blocked by the browser.
 */
export const MAINNET_LOG_RPC_URLS: string[] = [
  ...new Set([
    ...envList("VITE_BSC_MAINNET_LOG_RPC_URLS"),
    ...envList("VITE_BSC_MAINNET_RPC_FALLBACKS"),
    ...MAINNET_LOG_DEFAULTS,
  ]),
];

/** True when a dedicated (non default) Mainnet log provider is configured. */
export const HAS_DEDICATED_MAINNET_LOG_RPC = envList("VITE_BSC_MAINNET_LOG_RPC_URLS").length > 0;

type Opts = { batch?: boolean };

/**
 * Fallback transport: ranks live nodes first, retries transient failures and
 * moves on to the next provider when one starts erroring.
 *
 * `batch` is accepted for call-site compatibility but intentionally ignored:
 * the public BSC testnet seeds answer `-32005 limit exceeded` to batched
 * requests, which is one of the root causes of the trading failures.
 */
export function rpcTransport(urls: string[], _opts: Opts = {}): Transport {
  return fallback(
    urls.map((url) =>
      http(url, {
        batch: false,
        timeout: 20_000,
        retryCount: 3,
        retryDelay: 400,
      }),
    ),
    {
      rank: { interval: 30_000, sampleCount: 3, timeout: 4_000 },
      retryCount: 3,
      retryDelay: 300,
    },
  );
}

export const testnetTransport = (opts: Opts = {}) => rpcTransport(TESTNET_RPC_URLS, opts);
export const mainnetTransport = (opts: Opts = {}) => rpcTransport(MAINNET_RPC_URLS, opts);
