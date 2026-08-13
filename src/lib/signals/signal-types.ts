// LabsBNB Signal Engine — shared types and configuration contract.
// Client-safe (no server imports): the admin UI imports the same defaults the
// engine validates against, so the two can never drift.

export const SIGNAL_TYPES = [
  "NEW_TOKEN",
  "KING_OF_THE_HILL",
  "VOLUME_SPIKE",
  "NEW_ATH",
  "BONDING_PROGRESS",
  "GRADUATION",
  "WHALE_BUY",
  "WHALE_SELL",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_LABELS: Record<SignalType, string> = {
  NEW_TOKEN: "🚀 New Token",
  KING_OF_THE_HILL: "👑 King of the Hill",
  VOLUME_SPIKE: "🔥 Volume Spike",
  NEW_ATH: "🏆 New ATH",
  BONDING_PROGRESS: "📈 Bonding Progress",
  GRADUATION: "🎓 Graduation",
  WHALE_BUY: "🐋 Whale Buy",
  WHALE_SELL: "🐳 Whale Sell",
};

export type SignalStatus = "SENT" | "SKIPPED" | "FAILED";

/** Everything the engine needs, all persisted in `admin_config` (private keys). */
export type SignalConfig = {
  engine_enabled: boolean;
  enabled: Record<SignalType, boolean>;

  /** How many of the most recent factory tokens are scanned per run. */
  scan_tokens: number;
  /** Hard cap of Telegram messages published in a single run (anti-spam). */
  max_sends_per_run: number;

  volume_min_bnb: number;
  volume_multiplier: number;
  volume_window_min: number;
  volume_cooldown_min: number;
  /** Minimum number of complete historical windows required to trust a baseline. */
  volume_min_baseline_windows: number;

  whale_buy_bnb: number;
  whale_sell_bnb: number;
  whale_cooldown_min: number;

  bonding_milestones: number[];
  ath_min_change_pct: number;
  ath_cooldown_min: number;
  koth_cooldown_min: number;
  new_token_cooldown_min: number;
  graduation_cooldown_min: number;
};

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  engine_enabled: false,
  enabled: {
    NEW_TOKEN: true,
    KING_OF_THE_HILL: true,
    VOLUME_SPIKE: true,
    NEW_ATH: true,
    BONDING_PROGRESS: true,
    GRADUATION: true,
    WHALE_BUY: true,
    WHALE_SELL: true,
  },
  scan_tokens: 12,
  max_sends_per_run: 6,

  volume_min_bnb: 1,
  volume_multiplier: 3,
  volume_window_min: 15,
  volume_cooldown_min: 30,
  volume_min_baseline_windows: 4,

  whale_buy_bnb: 1,
  whale_sell_bnb: 1,
  whale_cooldown_min: 5,

  bonding_milestones: [50, 75, 80, 90, 95],
  ath_min_change_pct: 1,
  ath_cooldown_min: 10,
  koth_cooldown_min: 60,
  new_token_cooldown_min: 0,
  graduation_cooldown_min: 0,
};

/** A detected, validated candidate — not yet deduplicated nor published. */
export type SignalCandidate = {
  type: SignalType;
  tokenAddress: string;
  /** Deterministic event identity: tx hash, milestone, ATH price, king id… */
  eventId: string;
  /** Numeric value the rule triggered on (volume, ATH price, milestone…). */
  metric: number | null;
  txHash: string | null;
  /** Values used by the formatter — always real, never invented. */
  data: Record<string, unknown>;
};

export type SkipReason =
  | "duplicate"
  | "cooldown"
  | "disabled"
  | "insufficient-history"
  | "threshold-not-reached"
  | "baseline-unavailable"
  | "engine-disabled"
  | "send-budget"
  | "baseline-run"
  | "retry-limit";

export type SignalRunResult = {
  ranAt: string;
  engineEnabled: boolean;
  tokensScanned: number;
  detected: number;
  sent: number;
  skipped: number;
  failed: number;
  notes: string[];
};

export type SignalLogRow = {
  id: string;
  created_at: string;
  signal_type: string;
  token_address: string | null;
  token_symbol: string | null;
  event_id: string | null;
  tx_hash: string | null;
  status: SignalStatus;
  reason: string | null;
  error: string | null;
  metric: number | null;
  telegram_message_id: number | null;
};
