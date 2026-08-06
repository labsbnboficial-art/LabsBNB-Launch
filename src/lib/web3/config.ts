import { createConfig } from "wagmi";
import { testnetTransport, mainnetTransport, TESTNET_RPC_URLS } from "./rpc";
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

/** Testing phase: BNB Smart Chain Testnet (97) is the default/primary chain. */
export const BSC_TESTNET_RPC = TESTNET_RPC_URLS[0]!;

// NOTE: only BNB Smart Chain Testnet is registered. Trust Wallet / WalletConnect
// default to the FIRST chain announced in the session proposal, so listing
// Ethereum or BSC mainnet here made Trust connect on chain 1.
export const web3Config = createConfig({
  chains: [bscTestnet],
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
    [bscTestnet.id]: testnetTransport({ batch: true }),
    [bsc.id]: mainnetTransport({ batch: true }),
  },
  ssr: true,
});

export const BSC_TESTNET_CHAIN_ID = bscTestnet.id;
/** Active chain for the whole app during the testing phase. */
export const ACTIVE_CHAIN_ID = bscTestnet.id;
export const BSC_CHAIN_ID = bscTestnet.id;
