// Centralised RPC infrastructure for the launchpad.
//
// Public BNB testnet endpoints go down often (a dead node returns
// "Requested resource not available" / "no available nodes found", and viem
// then reports "RPC endpoint returned too many errors"). Every client in the
// app therefore uses a viem `fallback` transport over several providers with
// automatic ranking, retries and dead-node detection.
import { fallback, http, type Transport } from "viem";

/** BNB Smart Chain Testnet (97) — verified to answer eth_call/eth_getCode. */
export const TESTNET_RPC_URLS: string[] = [
  "https://bsc-testnet.drpc.org",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  "https://bnb-testnet.api.onfinality.io/public",
];

/** BNB Smart Chain Mainnet (56). */
export const MAINNET_RPC_URLS: string[] = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc.drpc.org",
];

/** Endpoints that actually serve `eth_getLogs` for the event indexer. */
export const LOG_RPC_URLS: string[] = [
  "https://bsc-testnet.drpc.org",
  "https://bsc-prebsc-dataseed.bnbchain.org",
  "https://bnb-testnet.api.onfinality.io/public",
  "https://data-seed-prebsc-1-s1.binance.org:8545",
];

type Opts = { batch?: boolean };

/** Fallback transport: ranks live nodes first, retries transient failures. */
export function rpcTransport(urls: string[], opts: Opts = {}): Transport {
  return fallback(
    urls.map((url) =>
      http(url, {
        batch: opts.batch ? { wait: 16 } : false,
        timeout: 15_000,
        retryCount: 2,
        retryDelay: 300,
      }),
    ),
    {
      rank: { interval: 60_000, sampleCount: 3, timeout: 4_000 },
      retryCount: 2,
      retryDelay: 250,
    },
  );
}

export const testnetTransport = (opts: Opts = {}) => rpcTransport(TESTNET_RPC_URLS, opts);
export const mainnetTransport = (opts: Opts = {}) => rpcTransport(MAINNET_RPC_URLS, opts);
