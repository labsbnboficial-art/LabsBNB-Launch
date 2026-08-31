import { describe, it, expect } from "vitest";
import {
  NETWORKS,
  ACTIVE_NETWORK,
  ACTIVE_CHAIN_ID,
  DEPRECATED_ADDRESSES,
  explorerAddressUrl,
  explorerTxUrl,
  explorerTokenUrl,
  isCorrectChain,
  networkByChainId,
  networkSafetyCheck,
  chainAddParams,
  FORBIDDEN_PUBLIC_ENV,
} from "./networks";

describe("network registry", () => {
  it("testnet uses chain id 97", () => {
    expect(NETWORKS.testnet.chainId).toBe(97);
    expect(NETWORKS.testnet.isTestnet).toBe(true);
  });

  it("mainnet uses chain id 56", () => {
    expect(NETWORKS.mainnet.chainId).toBe(56);
    expect(NETWORKS.mainnet.isTestnet).toBe(false);
  });

  it("resolves networks by chain id", () => {
    expect(networkByChainId(97)?.key).toBe("testnet");
    expect(networkByChainId(56)?.key).toBe("mainnet");
    expect(networkByChainId(1)).toBeNull();
  });
});

describe("explorer helpers", () => {
  it("switches explorer host per network", () => {
    const a = "0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9";
    expect(explorerAddressUrl(a, NETWORKS.testnet)).toBe(`https://testnet.bscscan.com/address/${a}`);
    expect(explorerAddressUrl(a, NETWORKS.mainnet)).toBe(`https://bscscan.com/address/${a}`);
    expect(explorerTxUrl("0xabc", NETWORKS.mainnet)).toBe("https://bscscan.com/tx/0xabc");
    expect(explorerTokenUrl(a, NETWORKS.testnet)).toContain("testnet.bscscan.com/token/");
  });

  it("mainnet explorer never points at testnet", () => {
    expect(NETWORKS.mainnet.explorer).not.toContain("testnet");
  });
});

describe("wrong network protection", () => {
  it("only the active chain id is accepted", () => {
    expect(isCorrectChain(ACTIVE_CHAIN_ID)).toBe(true);
    expect(isCorrectChain(1)).toBe(false);
    expect(isCorrectChain(undefined)).toBe(false);
    expect(isCorrectChain(ACTIVE_CHAIN_ID === 56 ? 97 : 56)).toBe(false);
  });

  it("chain add params match the active network", () => {
    const p = chainAddParams();
    expect(p.chainId).toBe(`0x${ACTIVE_NETWORK.chainId.toString(16)}`);
    expect(p.blockExplorerUrls[0]).toBe(ACTIVE_NETWORK.explorer);
  });
});

describe("mainnet safety check", () => {
  it("uses the deployed mainnet factory and passes the safety check", () => {
    const r = networkSafetyCheck(NETWORKS.mainnet);
    expect(NETWORKS.mainnet.contracts.factory).toBe("0xF0fDbF6fCa4FDBe9A6533C56AAa26feC68E85988");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("mainnet config never carries testnet rpc or contracts", () => {
    for (const url of NETWORKS.mainnet.rpcUrls) expect(url).not.toMatch(/testnet|prebsc/i);
    expect(NETWORKS.mainnet.contracts.router).not.toBe(NETWORKS.testnet.contracts.router);
    expect(NETWORKS.mainnet.contracts.wbnb).not.toBe(NETWORKS.testnet.contracts.wbnb);
  });

  it("testnet config passes the safety check", () => {
    expect(networkSafetyCheck(NETWORKS.testnet).ok).toBe(true);
  });
});

describe("no duplicated / stale critical config", () => {
  it("has a primary and at least one fallback rpc per network", () => {
    for (const n of Object.values(NETWORKS)) {
      expect(n.rpcUrls.length).toBeGreaterThan(1);
      expect(new Set(n.rpcUrls).size).toBe(n.rpcUrls.length);
    }
  });

  it("deprecated addresses are not reachable from any network config", () => {
    const active = Object.values(NETWORKS)
      .flatMap((n) => Object.values(n.contracts))
      .filter(Boolean)
      .map((a) => String(a).toLowerCase());
    for (const d of DEPRECATED_ADDRESSES) {
      expect(active).not.toContain(d.address.toLowerCase());
    }
  });

  it("secrets are never exposed through client (VITE_) env vars", () => {
    // Only VITE_-prefixed vars are inlined into the browser bundle.
    const clientKeys = Object.keys(import.meta.env as Record<string, unknown>).filter((k) =>
      k.startsWith("VITE_"),
    );
    for (const name of FORBIDDEN_PUBLIC_ENV) {
      expect(name.startsWith("VITE_")).toBe(false);
      expect(clientKeys).not.toContain(`VITE_${name}`);
      expect(clientKeys.some((k) => k.includes(name))).toBe(false);
    }
  });
});

describe("mainnet roles and isolation", () => {
  it("uses the dedicated mainnet fee, treasury and owner wallets", () => {
    const c = NETWORKS.mainnet.contracts;
    expect(c.feeWallet?.toLowerCase()).toBe("0xea265d939e27863dc169bfb0c21d84d4ed374e59");
    expect(c.treasury?.toLowerCase()).toBe("0x236716d4287e9f8f0de291450e2bfd0e04260b94");
    expect(c.owner?.toLowerCase()).toBe("0xbd93228c75ee66692de048b05782dbf1c4bb53c4");
    expect(c.feeWallet).not.toBe(c.treasury);
  });

  it("never reuses testnet factory / router / wbnb", () => {
    const r = networkSafetyCheck(NETWORKS.mainnet);
    const codes = r.issues.map((i) => i.code);
    expect(codes).not.toContain("FACTORY_TESTNET");
    expect(codes).not.toContain("ROUTER_TESTNET");
    expect(codes).not.toContain("WBNB_TESTNET");
    expect(codes).not.toContain("DEPRECATED_ADDRESS");
    expect(NETWORKS.mainnet.contracts.factory).not.toBe(NETWORKS.testnet.contracts.factory);
  });

  it("rejects chain id 97 as mainnet", () => {
    const bad = { ...NETWORKS.mainnet, chainId: 97 };
    expect(networkSafetyCheck(bad).issues.map((i) => i.code)).toContain("CHAIN_ID");
  });
});
