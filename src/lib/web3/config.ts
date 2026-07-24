import { createConfig, http } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

/**
 * LabsBNB Launchpad — Web3 configuration.
 * Primary connector: WalletConnect v2 (universal — supports MetaMask, Trust,
 * Binance, OKX, Rabby, SafePal, Coinbase, Brave and any WC v2 compatible wallet).
 */
export const WC_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ||
  "2f458dc35c78cea28a8fedd559464231";

const appMeta = {
  name: "LabsBNB Launchpad",
  description: "Launch tokens on BNB Chain",
  url: typeof window !== "undefined" ? window.location.origin : "https://labsbnb.app",
  icons: ["https://labsbnb.app/favicon.ico"],
};

export const web3Config = createConfig({
  chains: [bsc, bscTestnet],
  connectors: [
    walletConnect({
      projectId: WC_PROJECT_ID,
      metadata: appMeta,
      showQrModal: true,
    }),
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: appMeta.name }),
  ],
  transports: {
    [bsc.id]: http("https://bsc-dataseed.bnbchain.org"),
    [bscTestnet.id]: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
  },
  ssr: true,
});

export const BSC_CHAIN_ID = bsc.id;
export const BSC_TESTNET_CHAIN_ID = bscTestnet.id;
