// Hard deadline for on-chain reads.
//
// The viem fallback transport already retries and rotates RPC endpoints, but a
// node that accepts the socket and never answers can keep a promise pending
// forever — which is what left the chart / trades / holders panels spinning.
// Wrapping the read in a deadline turns that into a normal query error so the
// UI can show "Unable to load data" + Retry instead of an endless spinner.

export const RPC_TIMEOUT_MS = 25_000;

export class RpcTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Unable to load data: ${what} did not respond after ${Math.round(ms / 1000)}s (RPC timeout).`);
    this.name = "RpcTimeoutError";
  }
}

export function withRpcTimeout<T>(what: string, run: () => Promise<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new RpcTimeoutError(what, ms);
      // Useful for debugging, never contains secrets (endpoint list lives in rpc.ts).
      console.warn(`[rpc-timeout] ${what} exceeded ${ms}ms`);
      reject(err);
    }, ms);
    run().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
