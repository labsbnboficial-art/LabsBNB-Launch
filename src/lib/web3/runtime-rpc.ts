// ---------------------------------------------------------------------------
// Runtime RPC configuration bridge.
//
// Lovable Cloud secrets are RUNTIME (server) environment variables and reject
// the `VITE_` prefix, because `VITE_*` is a build-time browser variable. The
// frontend RPC architecture, however, expects `VITE_BSC_MAINNET_RPC_PRIMARY`.
//
// This bridge keeps BOTH working without hardcoding anything in source:
//   1. The server reads the value from `process.env` at SSR time, accepting the
//      canonical name `VITE_BSC_MAINNET_RPC_PRIMARY` and its Cloud-compatible
//      alias `BSC_MAINNET_RPC_PRIMARY`.
//   2. `RootShell` serialises it into an inline <script> inside <head>, which
//      runs BEFORE the app bundle, so `rpc.ts` sees it at module evaluation.
//   3. `rpc.ts` reads it through `runtimeRpcEnv()` with the exact same variable
//      names, so nothing else in the RPC / fallback architecture changes.
//
// Only public RPC endpoint URLs travel through this bridge. No private keys,
// no service-role secrets, nothing server-only is ever exposed here.
// ---------------------------------------------------------------------------

export const RUNTIME_RPC_GLOBAL = "__LABSBNB_RUNTIME_RPC__";

/** Canonical variable names, in the order the app resolves them. */
export const RUNTIME_RPC_VARS = [
  "VITE_BSC_MAINNET_RPC_PRIMARY",
  "VITE_BSC_MAINNET_RPC_FALLBACKS",
  "VITE_BSC_MAINNET_LOG_RPC_URLS",
  "VITE_BSC_TESTNET_RPC_PRIMARY",
  "VITE_BSC_TESTNET_RPC_FALLBACKS",
  "VITE_BSC_TESTNET_LOG_RPC_URLS",
] as const;

export type RuntimeRpcVar = (typeof RUNTIME_RPC_VARS)[number];
export type RuntimeRpcConfig = Partial<Record<RuntimeRpcVar, string>>;

/** `VITE_X` → `X`: the name a Lovable Cloud secret is allowed to use. */
export function cloudSecretAlias(name: RuntimeRpcVar): string {
  return name.replace(/^VITE_/, "");
}

function readProcessEnv(name: string): string | undefined {
  const value =
    typeof process !== "undefined" ? (process.env?.[name] as string | undefined) : undefined;
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Server-side snapshot of the public RPC endpoints. Returns `{}` in the
 * browser so hydration reuses the already injected object.
 */
export function collectRuntimeRpcConfig(): RuntimeRpcConfig {
  if (typeof window !== "undefined") {
    return (
      ((window as unknown as Record<string, RuntimeRpcConfig | undefined>)[RUNTIME_RPC_GLOBAL] ??
        {}) as RuntimeRpcConfig
    );
  }
  const config: RuntimeRpcConfig = {};
  for (const name of RUNTIME_RPC_VARS) {
    const value = readProcessEnv(name) ?? readProcessEnv(cloudSecretAlias(name));
    if (value) config[name] = value;
  }
  return config;
}

/** Reads one endpoint from the injected runtime config (browser or server). */
export function runtimeRpcEnv(name: string): string | undefined {
  const holder = globalThis as unknown as Record<string, RuntimeRpcConfig | undefined>;
  const value = holder[RUNTIME_RPC_GLOBAL]?.[name as RuntimeRpcVar];
  return value && value.trim() ? value.trim() : undefined;
}

/** Inline script body executed before the app bundle. */
export function runtimeRpcScript(config: RuntimeRpcConfig): string {
  return `window.${RUNTIME_RPC_GLOBAL}=Object.assign(window.${RUNTIME_RPC_GLOBAL}||{},${JSON.stringify(
    config,
  ).replace(/</g, "\\u003c")});`;
}
