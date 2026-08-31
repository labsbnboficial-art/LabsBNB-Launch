// ---------------------------------------------------------------------------
// LabsBNB Launchpad — SINGLE SOURCE OF TRUTH for network configuration.
//
// Every chain id, RPC endpoint, explorer URL and contract address used by the
// frontend must be read from here. Do not hardcode addresses or explorer URLs
// in components: import the helpers below instead.
//
// Switching to Mainnet later = fill `mainnet.contracts` + set
// VITE_LAUNCHPAD_NETWORK=mainnet. No component change should be required.
// ---------------------------------------------------------------------------
import {
  TESTNET_RPC_URLS,
  MAINNET_RPC_URLS,
  LOG_RPC_URLS,
  MAINNET_LOG_RPC_URLS,
  HAS_DEDICATED_MAINNET_LOG_RPC,
} from "./rpc";

export type NetworkKey = "testnet" | "mainnet";
export type Address = `0x${string}`;

export type NetworkConfig = {
  key: NetworkKey;
  chainId: number;
  name: string;
  shortName: string;
  currency: { name: string; symbol: string; decimals: number };
  isTestnet: boolean;
  /** First entry = PRIMARY RPC, rest = FALLBACKS (ranked at runtime by viem). */
  rpcUrls: readonly string[];
  /** Endpoints verified to serve `eth_getLogs` (chart / trades / holders). */
  logRpcUrls: readonly string[];
  explorer: string;
  contracts: {
    /** LabsBNBFactory. `null` = not deployed yet on this network. */
    factory: Address | null;
    /** PancakeSwap V2 router used at migration. */
    router: Address | null;
    wbnb: Address | null;
    /** Fee recipient (buy/sell + creation fees). */
    feeWallet: Address | null;
    /** Launchpad treasury (Impulso, campaigns, advanced creation fee). */
    treasury: Address | null;
    /** Contract owner / admin wallet expected after deployment. */
    owner: Address | null;
  };
};

const LABSBNB_WALLET = "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e" as Address;

/** Mainnet role split (fee, treasury and owner are three distinct wallets). */
const MAINNET_FEE_WALLET = "0xEA265D939E27863dC169Bfb0c21D84d4Ed374E59" as Address;
const MAINNET_TREASURY = "0x236716d4287E9f8F0de291450E2bFd0e04260b94" as Address;
const MAINNET_OWNER = "0xbd93228c75EE66692dE048B05782DBF1c4Bb53c4" as Address;
/** Deployed LabsBNBFactory on BNB Smart Chain Mainnet (chain 56). */
const MAINNET_FACTORY = "0xF0fDbF6fCa4FDBe9A6533C56AAa26feC68E85988" as Address;

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    key: "testnet",
    chainId: 97,
    name: "BNB Smart Chain Testnet",
    shortName: "BSC Testnet",
    currency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    isTestnet: true,
    rpcUrls: TESTNET_RPC_URLS,
    logRpcUrls: LOG_RPC_URLS,
    explorer: "https://testnet.bscscan.com",
    contracts: {
      factory: "0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9",
      router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
      wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
      feeWallet: LABSBNB_WALLET,
      treasury: LABSBNB_WALLET,
      owner: LABSBNB_WALLET,
    },
  },
  mainnet: {
    key: "mainnet",
    chainId: 56,
    name: "BNB Smart Chain",
    shortName: "BSC",
    currency: { name: "BNB", symbol: "BNB", decimals: 18 },
    isTestnet: false,
    rpcUrls: MAINNET_RPC_URLS,
    logRpcUrls: MAINNET_LOG_RPC_URLS,
    explorer: "https://bscscan.com",
    contracts: {
      factory: MAINNET_FACTORY,
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      feeWallet: MAINNET_FEE_WALLET,
      treasury: MAINNET_TREASURY,
      owner: MAINNET_OWNER,
    },
  },
};

/**
 * Deprecated / historical addresses. Kept ONLY so we can assert no route uses
 * them again. Never reference these for reads or writes.
 */
export const DEPRECATED_ADDRESSES: { address: string; note: string }[] = [
  {
    address: "0x9B2b5A1E6a4C7c4B36c1E9F1C2A0D5f7e8B3d4C6",
    note: "Placeholder factory used before the 2026-01 testnet deployment. Never deployed.",
  },
];

function readEnvNetwork(): NetworkKey {
  const raw =
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.["VITE_LAUNCHPAD_NETWORK"] as string | undefined)
      : undefined) ?? "";
  // Mainnet is the default: only an explicit `testnet` opt-in leaves chain 56.
  return raw.trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
}

/** Active network key for this build. Defaults to `mainnet` (chain 56). */
export const ACTIVE_NETWORK_KEY: NetworkKey = readEnvNetwork();
export const ACTIVE_NETWORK: NetworkConfig = NETWORKS[ACTIVE_NETWORK_KEY];
export const ACTIVE_CHAIN_ID = ACTIVE_NETWORK.chainId;
export const IS_TESTNET_ENV = ACTIVE_NETWORK.isTestnet;

export function networkByChainId(chainId: number): NetworkConfig | null {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId) ?? null;
}

export function chainLabel(chainId: number | undefined): string {
  if (chainId === undefined) return "Unknown network";
  return networkByChainId(chainId)?.name ?? `Chain ${chainId}`;
}

/** True only when the wallet sits on the chain this build targets. */
export function isCorrectChain(chainId: number | undefined): boolean {
  return chainId === ACTIVE_CHAIN_ID;
}

// --------------------------- Explorer helpers ------------------------------

const base = (net: NetworkConfig = ACTIVE_NETWORK) => net.explorer.replace(/\/+$/, "");

export function explorerAddressUrl(address: string, net: NetworkConfig = ACTIVE_NETWORK) {
  return `${base(net)}/address/${address}`;
}
export function explorerTxUrl(hash: string, net: NetworkConfig = ACTIVE_NETWORK) {
  return `${base(net)}/tx/${hash}`;
}
export function explorerTokenUrl(address: string, net: NetworkConfig = ACTIVE_NETWORK) {
  return `${base(net)}/token/${address}`;
}
export function explorerContractUrl(address: string, net: NetworkConfig = ACTIVE_NETWORK) {
  return `${base(net)}/address/${address}#code`;
}

/** EIP-3085 payload so wallets that don't know the chain can add it. */
export function chainAddParams(net: NetworkConfig = ACTIVE_NETWORK) {
  return {
    chainId: `0x${net.chainId.toString(16)}`,
    chainName: net.name,
    nativeCurrency: net.currency,
    rpcUrls: [...net.rpcUrls].slice(0, 2),
    blockExplorerUrls: [base(net)],
  } as const;
}

// ------------------------ Environment validation ---------------------------

export type SafetyIssue = { level: "error" | "warning"; code: string; message: string };

/**
 * Pre-deploy safety check. Pure/read-only: never signs or sends anything.
 * Used by the admin panel and by CI before switching to Mainnet.
 */
export function networkSafetyCheck(net: NetworkConfig = ACTIVE_NETWORK): {
  ok: boolean;
  network: NetworkKey;
  chainId: number;
  issues: SafetyIssue[];
} {
  const issues: SafetyIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });

  if (net.key === "mainnet" && net.chainId !== 56) err("CHAIN_ID", "Mainnet must use chain id 56.");
  if (net.key === "testnet" && net.chainId !== 97) err("CHAIN_ID", "Testnet must use chain id 97.");

  if (!net.contracts.factory) err("FACTORY", `Factory address is PENDING on ${net.name}.`);
  if (!net.contracts.router) err("ROUTER", `Router address is missing on ${net.name}.`);
  if (!net.contracts.feeWallet) err("FEE_WALLET", "Fee wallet is not configured.");
  if (!net.contracts.treasury) err("TREASURY", "Treasury wallet is not configured.");
  if (!net.contracts.owner) err("OWNER", "Owner wallet is not configured.");

  // Mainnet must never reuse Testnet deployments or deprecated addresses.
  const eq = (a: string | null, b: string | null) =>
    !!a && !!b && a.toLowerCase() === b.toLowerCase();
  if (!net.isTestnet) {
    const t = NETWORKS.testnet.contracts;
    if (eq(net.contracts.factory, t.factory)) err("FACTORY_TESTNET", "Mainnet is using the Testnet factory.");
    if (eq(net.contracts.router, t.router)) err("ROUTER_TESTNET", "Mainnet is using the Testnet router.");
    if (eq(net.contracts.wbnb, t.wbnb)) err("WBNB_TESTNET", "Mainnet is using the Testnet WBNB.");
  }
  const deprecated = new Set(DEPRECATED_ADDRESSES.map((d) => d.address.toLowerCase()));
  for (const [role, addr] of Object.entries(net.contracts)) {
    if (addr && deprecated.has(String(addr).toLowerCase())) {
      err("DEPRECATED_ADDRESS", `Deprecated address configured as ${role} on ${net.name}.`);
    }
  }


  const wrongExplorer = net.isTestnet
    ? !net.explorer.includes("testnet.bscscan.com")
    : net.explorer.includes("testnet.");
  if (wrongExplorer) err("EXPLORER", "Explorer URL does not match the network.");

  const testnetRpc = net.rpcUrls.some((u) => /testnet|prebsc/i.test(u));
  if (!net.isTestnet && testnetRpc) err("RPC", "Mainnet build is pointing at a Testnet RPC.");
  if (net.rpcUrls.length < 2) warn("RPC_FALLBACK", "No fallback RPC configured.");
  if (net.logRpcUrls.length === 0) err("LOG_RPC", `No eth_getLogs endpoint configured on ${net.name}.`);
  if (!net.isTestnet && !HAS_DEDICATED_MAINNET_LOG_RPC) {
    warn(
      "LOG_RPC_DEDICATED",
      "Mainnet is using public log endpoints. Set VITE_BSC_MAINNET_LOG_RPC_URLS with a dedicated provider before launch.",
    );
  }

  if (!net.isTestnet && net.contracts.feeWallet === net.contracts.treasury) {
    warn("WALLETS", "Fee wallet and treasury are the same address on Mainnet.");
  }

  return { ok: issues.every((i) => i.level !== "error"), network: net.key, chainId: net.chainId, issues };
}

/** Names of client env vars that must never be printed or rendered. */
export const FORBIDDEN_PUBLIC_ENV = [
  "PRIVATE_KEY",
  "SIGNALS_CRON_SECRET",
  "LABSBNB_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BSCSCAN_API_KEY",
  "LOVABLE_API_KEY",
  "TELEGRAM_BOT_TOKEN",
] as const;
