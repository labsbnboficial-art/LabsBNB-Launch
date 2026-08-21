import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicConfig } from "@/lib/config.functions";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";

export type LaunchpadConfig = {
  admin_wallet: string;
  factory_address: `0x${string}` | null;
  rpc_url: string;
  chain_id: number;
  fee_bps: number;
  fee_wallet: string;
  curve_target_bnb: string; // wei string
  burn_pct: number;
  liquidity_pct: number;
  lp_pct: number;
  staking_pct: number;
  creation_fee_bnb: string;
  buy_fee_bps: number;
  sell_fee_bps: number;
  staking_cost_bnb: string;
  reward_pct: number;
  advanced_creation_fee_bnb: string;
  campaign_fee_bnb: string;
  missions_enabled: boolean;
  // AntiBot
  antibot_enabled: boolean;
  antibot_max_buy_bnb: string;      // wei
  antibot_max_wallet_tk: string;    // wei-tokens
  antibot_max_tx_tk: string;        // wei-tokens
  antibot_cooldown_s: number;
  antibot_anti_sandwich: boolean;
  antibot_anti_flashloan: boolean;
};

export const DEFAULT_CONFIG: LaunchpadConfig = {
  admin_wallet: (ACTIVE_NETWORK.contracts.treasury ?? "") as string,
  factory_address: ACTIVE_NETWORK.contracts.factory,
  rpc_url: ACTIVE_NETWORK.rpcUrls[0]!,
  chain_id: ACTIVE_NETWORK.chainId,
  fee_bps: 50,
  fee_wallet: (ACTIVE_NETWORK.contracts.feeWallet ?? "") as string,
  curve_target_bnb: "24000000000000000000",
  burn_pct: 0,
  liquidity_pct: 100,
  lp_pct: 0,
  staking_pct: 0,
  creation_fee_bnb: "0",
  buy_fee_bps: 50,
  sell_fee_bps: 50,
  staking_cost_bnb: "0",
  reward_pct: 0,
  advanced_creation_fee_bnb: "10000000000000000",
  campaign_fee_bnb: "10000000000000000",
  missions_enabled: true,
  antibot_enabled: false,
  antibot_max_buy_bnb: "0",
  antibot_max_wallet_tk: "0",
  antibot_max_tx_tk: "0",
  antibot_cooldown_s: 0,
  antibot_anti_sandwich: true,
  antibot_anti_flashloan: true,
};

/** Testing phase: the launchpad is locked to BNB Smart Chain Testnet (97). */
export const TESTNET_CHAIN_ID = ACTIVE_NETWORK.chainId;
export const TESTNET_FACTORY = (ACTIVE_NETWORK.contracts.factory ?? "0x") as `0x${string}`;

function coerce(cfg: Record<string, unknown>): LaunchpadConfig {
  const g = <T,>(k: keyof LaunchpadConfig, fallback: T): T => {
    const v = cfg[k as string];
    return (v ?? fallback) as T;
  };
  const rawFactory = String(g("factory_address", "") ?? "").trim();
  const factory = /^0x[a-fA-F0-9]{40}$/.test(rawFactory)
    ? (rawFactory as `0x${string}`)
    : TESTNET_FACTORY;
  return {
    admin_wallet: String(g("admin_wallet", DEFAULT_CONFIG.admin_wallet)),
    factory_address: factory,
    rpc_url: DEFAULT_CONFIG.rpc_url,
    chain_id: TESTNET_CHAIN_ID,
    fee_bps: Number(g("fee_bps", DEFAULT_CONFIG.fee_bps)),
    fee_wallet: String(g("fee_wallet", DEFAULT_CONFIG.fee_wallet)),
    curve_target_bnb: String(g("curve_target_bnb", DEFAULT_CONFIG.curve_target_bnb)),
    burn_pct: Number(g("burn_pct", 0)),
    liquidity_pct: Number(g("liquidity_pct", 100)),
    lp_pct: Number(g("lp_pct", 0)),
    staking_pct: Number(g("staking_pct", 0)),
    creation_fee_bnb: String(g("creation_fee_bnb", "0")),
    buy_fee_bps: Number(g("buy_fee_bps", DEFAULT_CONFIG.buy_fee_bps)),
    sell_fee_bps: Number(g("sell_fee_bps", DEFAULT_CONFIG.sell_fee_bps)),
    staking_cost_bnb: String(g("staking_cost_bnb", "0")),
    reward_pct: Number(g("reward_pct", 0)),
    advanced_creation_fee_bnb: String(g("advanced_creation_fee_bnb", DEFAULT_CONFIG.advanced_creation_fee_bnb)),
    campaign_fee_bnb: String(g("campaign_fee_bnb", DEFAULT_CONFIG.campaign_fee_bnb)),
    missions_enabled: Boolean(g("missions_enabled", true)),
    antibot_enabled: Boolean(g("antibot_enabled", false)),
    antibot_max_buy_bnb: String(g("antibot_max_buy_bnb", "0")),
    antibot_max_wallet_tk: String(g("antibot_max_wallet_tk", "0")),
    antibot_max_tx_tk: String(g("antibot_max_tx_tk", "0")),
    antibot_cooldown_s: Number(g("antibot_cooldown_s", 0)),
    antibot_anti_sandwich: Boolean(g("antibot_anti_sandwich", true)),
    antibot_anti_flashloan: Boolean(g("antibot_anti_flashloan", true)),
  };
}

export function useLaunchpadConfig() {
  const fetchConfig = useServerFn(getPublicConfig);
  return useQuery({
    queryKey: ["launchpad-config"],
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<LaunchpadConfig> => {
      try {
        return coerce(await fetchConfig());
      } catch {
        // Never let a config read break the UI — fall back to defaults.
        return DEFAULT_CONFIG;
      }
    },
  });
}
