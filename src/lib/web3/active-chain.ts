// Single helper to resolve the viem chain object + transport for the ACTIVE
// network (chain 56 by default, chain 97 only with VITE_LAUNCHPAD_NETWORK=testnet).
// Every client/server read path must use this instead of importing `bscTestnet`.
import { bsc, bscTestnet } from "viem/chains";
import { ACTIVE_NETWORK } from "./networks";
import { rpcTransport } from "./rpc";

export function activeViemChain() {
  return ACTIVE_NETWORK.chainId === bsc.id ? bsc : bscTestnet;
}

export function activeTransport(opts: { batch?: boolean } = {}) {
  return rpcTransport([...ACTIVE_NETWORK.rpcUrls], opts);
}
