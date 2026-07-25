import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  admin_wallet: "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e",
  factory_address: null,
  rpc_url: "https://data-seed-prebsc-1-s1.binance.org:8545",
  chain_id: 97,
  fee_bps: 50,
  fee_wallet: "0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e",
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
  antibot_enabled: false,
  antibot_max_buy_bnb: "0",
  antibot_max_wallet_tk: "0",
  antibot_max_tx_tk: "0",
  antibot_cooldown_s: 0,
  antibot_anti_sandwich: true,
  antibot_anti_flashloan: true,
};

function coerce(cfg: Record<string, unknown>): LaunchpadConfig {
  const g = <T,>(k: keyof LaunchpadConfig, fallback: T): T => {
    const v = cfg[k as string];
    return (v ?? fallback) as T;
  };
  return {
    admin_wallet: String(g("admin_wallet", DEFAULT_CONFIG.admin_wallet)),
    factory_address: (g("factory_address", null) as `0x${string}` | null) || null,
    rpc_url: String(g("rpc_url", DEFAULT_CONFIG.rpc_url)),
    chain_id: Number(g("chain_id", DEFAULT_CONFIG.chain_id)),
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
  return useQuery({
    queryKey: ["launchpad-config"],
    staleTime: 30_000,
    queryFn: async (): Promise<LaunchpadConfig> => {
      const { data, error } = await supabase.from("admin_config").select("key,value").eq("is_public", true);
      if (error) throw error;
      const map: Record<string, unknown> = {};
      (data ?? []).forEach((r) => { map[r.key] = r.value; });
      return coerce(map);
    },
  });
}
