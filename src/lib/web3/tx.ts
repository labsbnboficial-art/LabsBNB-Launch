// Shared wallet/transaction plumbing: network guard + human-readable errors.
//
// Why this exists: WalletConnect/Trust/Binance wallets frequently answer
// `wallet_switchEthereumChain` with -32002 / -32601, which viem surfaces as
// "Requested resource not available". wagmi ALSO triggers that same switch
// internally when `chainId` is passed to `writeContract`, so a single flaky
// wallet response blocked create/buy/sell everywhere. We now switch once,
// tolerate the failure, re-check the connector chain and only then write.

export type SwitchChain = (args: { chainId: number }) => Promise<unknown>;

const CHAIN_NAMES: Record<number, string> = {
  97: "BNB Smart Chain Testnet",
  56: "BNB Smart Chain",
};

export function chainName(id: number) {
  return CHAIN_NAMES[id] ?? `chain ${id}`;
}

/** EIP-3085 payload so wallets that don't know chain 97 (Trust Wallet) can add it. */
export const BSC_TESTNET_PARAMS = {
  chainId: "0x61",
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: [
    "https://bsc-prebsc-dataseed.bnbchain.org",
    "https://data-seed-prebsc-1-s1.binance.org:8545",
  ],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
} as const;

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function injectedProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

/** Last-resort switch/add through the raw EIP-1193 provider (Trust Wallet path). */
async function rawSwitch(target: number): Promise<void> {
  const provider = injectedProvider();
  if (!provider) return;
  const hex = `0x${target.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || code === -32603 || code === -32602) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [target === 97 ? BSC_TESTNET_PARAMS : { chainId: hex }],
      });
      return;
    }
    throw e;
  }
}

/**
 * Ensures the connected wallet sits on `target`.
 * Never throws for a rejected/unsupported switch request on its own: it
 * re-reads the chain afterwards and only fails when it is genuinely wrong.
 */
export async function ensureChain(
  target: number,
  current: number | undefined,
  switchChainAsync: SwitchChain,
  reread?: () => Promise<number | undefined> | number | undefined,
): Promise<void> {
  if (current === target) return;
  let switchError: unknown = null;
  try {
    await switchChainAsync({ chainId: target });
  } catch (e) {
    switchError = e;
    console.warn("[labsbnb] switchChain failed", describeTxError(e));
    // Trust Wallet / WalletConnect often reject wagmi's switch but accept the
    // raw request, and need the network to be added first.
    try {
      await rawSwitch(target);
      switchError = null;
    } catch (e2) {
      console.warn("[labsbnb] wallet_addEthereumChain failed", describeTxError(e2));
    }
  }

  const after = reread ? await reread() : undefined;
  if (after === target) return;
  // Give the wallet a moment: several mobile wallets resolve the switch late.
  if (switchError === null) return;

  throw new Error(
    `Tu wallet no está en ${chainName(target)} (chain ID ${target}). ` +
      `Cámbiala manualmente en la wallet y vuelve a intentarlo. Detalle: ${describeTxError(switchError)}`,
  );
}


type AnyErr = {
  code?: number | string;
  shortMessage?: string;
  details?: string;
  message?: string;
  cause?: unknown;
  name?: string;
};

/** Maps wallet / RPC / contract failures to a clear Spanish message. */
export function describeTxError(error: unknown): string {
  const e = (error ?? {}) as AnyErr;
  const cause = (e.cause ?? {}) as AnyErr;
  const code = e.code ?? cause.code;
  const raw = [e.shortMessage, e.details, e.message, cause.shortMessage, cause.message]
    .filter(Boolean)
    .join(" | ");
  const lower = raw.toLowerCase();

  if (code === 4001 || lower.includes("user rejected") || lower.includes("user denied")) {
    return "Firma cancelada en la wallet.";
  }
  if (code === -32002 || lower.includes("already pending") || lower.includes("request already")) {
    return "Ya hay una petición abierta en tu wallet. Ábrela y acéptala o recházala antes de reintentar.";
  }
  if (code === 4902 || lower.includes("unrecognized chain") || lower.includes("chain not")) {
    return "Tu wallet no tiene añadida BNB Smart Chain Testnet (97). Añádela y reintenta.";
  }
  if (lower.includes("requested resource not available")) {
    return "La wallet o el nodo RPC rechazaron la petición (recurso no disponible). Revisa que la wallet esté en BNB Testnet y que no tenga otra petición pendiente.";
  }
  if (lower.includes("insufficient funds")) return "Saldo insuficiente de tBNB para el importe + gas.";
  if (lower.includes("nonce")) return "Conflicto de nonce: espera a que confirme tu transacción anterior o reinicia la cuenta en la wallet.";
  if (lower.includes("intrinsic gas") || lower.includes("gas required exceeds")) {
    return "Estimación de gas fallida: la transacción revertiría con estos parámetros.";
  }
  if (lower.includes("slippage") || lower.includes("min out") || lower.includes("minout")) {
    return "Slippage superado: el precio se movió. Reintenta o aumenta la tolerancia.";
  }
  if (lower.includes("too many errors") || lower.includes("limit exceeded") || lower.includes("timeout")) {
    return "Los nodos RPC públicos están saturados. Reintenta en unos segundos.";
  }
  return e.shortMessage || e.details || e.message || "Error desconocido.";
}

// ---------------------------------------------------------------------------
// Full-fidelity RPC diagnostics.
//
// Trust Wallet / WalletConnect frequently answer with `{ code: -32603 }` and no
// message, which viem prints as "An unknown RPC error occurred". That string is
// useless on its own, so we walk the whole `cause` chain, dump every field to
// the console together with the exact request context, and surface the deepest
// real message we can find in the UI.
// ---------------------------------------------------------------------------

export type TxContext = {
  action: string;
  chainId?: number;
  walletChainId?: number;
  account?: string;
  to?: string;
  contract?: string;
  functionName?: string;
  args?: unknown;
  value?: bigint;
  gas?: bigint;
  rpcUrl?: string;
  connector?: string;
};

type ErrLike = Record<string, unknown>;

function causeChain(error: unknown, depth = 8): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = error;
  while (cur && typeof cur === "object" && out.length < depth) {
    const e = cur as ErrLike;
    out.push({
      name: e["name"],
      message: e["message"],
      shortMessage: e["shortMessage"],
      details: e["details"],
      code: e["code"],
      data: e["data"],
      reason: e["reason"],
      metaMessages: e["metaMessages"],
      version: e["version"],
    });
    cur = e["cause"];
  }
  return out;
}

/** Console dump of the untouched provider error plus the request context. */
export function logTxError(error: unknown, ctx: TxContext) {
  const chain = causeChain(error);
  // eslint-disable-next-line no-console
  console.group?.(`[labsbnb] tx failed — ${ctx.action}`);
  // eslint-disable-next-line no-console
  console.error("raw error", error);
  // eslint-disable-next-line no-console
  console.error("cause chain", chain);
  // eslint-disable-next-line no-console
  console.error("context", {
    ...ctx,
    value: ctx.value?.toString(),
    gas: ctx.gas?.toString(),
  });
  // eslint-disable-next-line no-console
  console.groupEnd?.();
  return chain;
}

/** Deepest human-usable text found anywhere in the error chain. */
function deepestMessage(error: unknown): string {
  const parts: string[] = [];
  for (const e of causeChain(error)) {
    for (const key of ["shortMessage", "details", "reason", "message"] as const) {
      const v = e[key];
      if (typeof v === "string" && v.trim() && !parts.includes(v)) parts.push(v.trim());
    }
    const data = e["data"];
    if (typeof data === "string" && data.startsWith("0x") && data.length > 2) parts.push(`data ${data}`);
    const meta = e["metaMessages"];
    if (Array.isArray(meta)) for (const m of meta) if (typeof m === "string") parts.push(m);
  }
  return parts.join(" | ");
}

function firstCode(error: unknown): number | string | undefined {
  for (const e of causeChain(error)) {
    const c = e["code"];
    if (typeof c === "number" || typeof c === "string") return c;
  }
  return undefined;
}

/**
 * Human message + the untouched technical detail appended, so nothing is ever
 * hidden behind a generic string. Also logs the full error to the console.
 */
export function describeTxErrorVerbose(error: unknown, ctx: TxContext): string {
  logTxError(error, ctx);
  const friendly = describeTxError(error);
  const code = firstCode(error);
  const deep = deepestMessage(error);

  // viem's placeholder when the wallet returns -32603 with no payload.
  const opaque = /unknown rpc error/i.test(deep) || (!deep && code === -32603);
  if (opaque) {
    return (
      `La wallet devolvió un error RPC sin detalle (code ${String(code ?? "-32603")}). ` +
      `Suele ocurrir en Trust Wallet cuando la sesión WalletConnect quedó en otra red: ` +
      `abre Trust → Settings → WalletConnect, cierra la sesión de LabsBNB, ` +
      `selecciona BNB Smart Chain Testnet (97) y vuelve a conectar. ` +
      `Contexto: ${ctx.action}, chain ${ctx.chainId} (wallet ${ctx.walletChainId ?? "?"}), ` +
      `to ${ctx.to ?? ctx.contract ?? "?"}, value ${ctx.value?.toString() ?? "0"} wei` +
      (ctx.gas ? `, gas ${ctx.gas.toString()}` : "")
    );
  }

  const technical = [code != null ? `code ${code}` : null, deep || null].filter(Boolean).join(" — ");
  return technical && !friendly.includes(technical) ? `${friendly} [${technical}]` : friendly;
}
