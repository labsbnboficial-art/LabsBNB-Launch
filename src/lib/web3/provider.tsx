import { WagmiProvider } from "wagmi";
import type { ReactNode } from "react";
import { web3Config } from "./config";

export function Web3Provider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={web3Config}>{children}</WagmiProvider>;
}
