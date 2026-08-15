import { describe, expect, it } from "vitest";
import { validateConfig, ConfigValidationError } from "./signal-config.server";
import { fingerprint } from "./signal-dedupe.server";
import { DEFAULT_SIGNAL_CONFIG } from "./signal-types";

describe("signal config validation", () => {
  it("keeps defaults when nothing is provided", () => {
    expect(validateConfig({})).toEqual(DEFAULT_SIGNAL_CONFIG);
  });

  it("rejects a volume multiplier <= 1", () => {
    expect(() => validateConfig({ volume_multiplier: 1 })).toThrow(ConfigValidationError);
  });

  it("rejects negative cooldowns and NaN thresholds", () => {
    expect(() => validateConfig({ whale_cooldown_min: -1 })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ whale_buy_bnb: Number.NaN })).toThrow(ConfigValidationError);
  });

  it("rejects milestones outside 0..100 and dedupes them", () => {
    expect(() => validateConfig({ bonding_milestones: [50, 120] })).toThrow(ConfigValidationError);
    expect(validateConfig({ bonding_milestones: [90, 50, 50] }).bonding_milestones).toEqual([50, 90]);
  });
});

describe("deduplication fingerprint", () => {
  it("is deterministic and case-insensitive on the token address", () => {
    const a = fingerprint("NEW_ATH", "0xABC", "evt-1");
    const b = fingerprint("NEW_ATH", "0xabc", "evt-1");
    expect(a).toBe(b);
  });

  it("differs per event and per type", () => {
    expect(fingerprint("NEW_ATH", "0xabc", "evt-1")).not.toBe(fingerprint("NEW_ATH", "0xabc", "evt-2"));
    expect(fingerprint("NEW_ATH", "0xabc", "evt-1")).not.toBe(fingerprint("WHALE_BUY", "0xabc", "evt-1"));
  });
});
