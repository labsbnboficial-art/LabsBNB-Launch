// Static guarantees of the Creator System (Fase 2A):
//  • no client-callable mutation exists → score/stats/badges cannot be edited
//  • every persistence read is scoped to the active chain (Mainnet isolation)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as creatorFns from "@/lib/creator.functions";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("unauthorized profile modification", () => {
  it("exposes read-only server functions only", () => {
    expect(Object.keys(creatorFns).sort()).toEqual(["getCreator", "getTopCreators", "leaderboardSchema"]);
  });

  it("never writes to creator/reputation tables from the app code", () => {
    const files = [
      "src/lib/creator.functions.ts",
      "src/lib/creator/creator-store.server.ts",
      "src/lib/creator/creator-service.server.ts",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });
});

describe("cross-chain isolation", () => {
  it("scopes every stored read to the active chain id", () => {
    const store = read("src/lib/creator/creator-store.server.ts");
    const chainFilters = store.match(/\.eq\("chain_id", chainId\)/g) ?? [];
    expect(chainFilters.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the mainnet ACTIVE_CHAIN_ID into the aggregation service", () => {
    const svc = read("src/lib/creator/creator-service.server.ts");
    expect(svc).toContain("ACTIVE_CHAIN_ID");
    expect(svc).not.toMatch(/\b97\b/);
  });
});
