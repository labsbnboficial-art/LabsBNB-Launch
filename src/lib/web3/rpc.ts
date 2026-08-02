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
import { fallback, http, type Transport } from "viem";

/** BNB Smart Chain Testnet (97) — verified to answer eth_call/eth_getCode. */
export const TESTNET_RPC_URLS: string[] = [
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://bsc-testnet.drpc.org",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-1-s2.binance.org:8545",
  "https://data-seed-prebsc-2-s2.binance.org:8545",
  "https://api.zan.top/bsc-testnet",
];

/** BNB Smart Chain Mainnet (56). */
export const MAINNET_RPC_URLS: string[] = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc.drpc.org",
];

/** Endpoints that actually serve `eth_getLogs` for the event indexer. */
export const LOG_RPC_URLS: string[] = [
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://bsc-testnet.drpc.org",
  "https://api.zan.top/bsc-testnet",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
];

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
