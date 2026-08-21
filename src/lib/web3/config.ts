import { createConfig } from "wagmi";
import { rpcTransport, TESTNET_RPC_URLS } from "./rpc";
import { bsc, bscTestnet } from "wagmi/chains";
import { ACTIVE_NETWORK, NETWORKS } from "./networks";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

/** Chain object for the active build (centralized in ./networks). */
export const activeChain = ACTIVE_NETWORK.chainId === bsc.id ? bsc : bscTestnet;

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
  chains: [activeChain, activeChain.id === bsc.id ? bscTestnet : bsc] as const,
  connectors: [
    walletConnect({
      projectId: WC_PROJECT_ID,
      metadata: appMeta,
      showQrModal: true,
    }),
    injected({ shimDisconnect: true }),
    // `preference: "all"` keeps both the Coinbase extension and the mobile /
    // smart-wallet popup available. Requires @coinbase/wallet-sdk v4, which is
    // an optional peer of @wagmi/connectors and must stay installed.
    coinbaseWallet({
      appName: appMeta.name,
      appLogoUrl: appMeta.icons[0],
      preference: { options: "all" },
    }),
  ],
  // EIP-6963: wagmi adds one connector per announced wallet, so each browser
  // wallet keeps its own provider instead of everyone sharing window.ethereum.
  multiInjectedProviderDiscovery: true,
  transports: {
    [bsc.id]: rpcTransport([...NETWORKS.mainnet.rpcUrls], { batch: true }),
    [bscTestnet.id]: rpcTransport([...NETWORKS.testnet.rpcUrls], { batch: true }),
  },

  ssr: true,
});

export const BSC_TESTNET_CHAIN_ID = bscTestnet.id;
/** Active chain for the whole app during the testing phase. */
export const ACTIVE_CHAIN_ID = activeChain.id;
export const BSC_CHAIN_ID = activeChain.id;
export const ACTIVE_CHAIN = activeChain;
