// EIP-6963 provider discovery + injected-availability detection.
//
// Why this exists: wagmi's generic `injected()` connector resolves its provider
// from `window.ethereum` at connect time and throws `ProviderNotFoundError`
// ("Provider not found") when it is absent. Extensions inject that global
// asynchronously, so a user clicking "Connect" right after hydration hit the
// error even with MetaMask installed. We therefore:
//   1. listen to `eip6963:announceProvider` and keep a registry (rdns/name/uuid),
//   2. re-emit `eip6963:requestProvider` a few times with a short, bounded
//      timeout (no infinite polling),
//   3. expose the state so the UI can show `detecting` before `available`.
//
// We never write to `window.ethereum`, never pick `providers[0]`, and never
// hand a provider to a connector: wagmi's own connector remains the source of
// truth for the actual EIP-1193 object.

export type Eip6963Info = {
  uuid: string;
  name: string;
  icon?: string;
  rdns: string;
};

type AnnounceEvent = CustomEvent<{ info: Eip6963Info; provider: unknown }>;

const registry = new Map<string, Eip6963Info>();
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function onAnnounce(event: Event) {
  const detail = (event as AnnounceEvent).detail;
  const info = detail?.info;
  if (!info?.uuid || registry.has(info.uuid)) return;
  registry.set(info.uuid, info);
  // eslint-disable-next-line no-console
  console.info(
    `[WALLET_PROVIDER] discovered name=${info.name} rdns=${info.rdns} uuid=${info.uuid}`,
  );
  emit();
}

/** Starts (idempotently) the EIP-6963 discovery handshake. */
export function startProviderDiscovery() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  const request = () => window.dispatchEvent(new Event("eip6963:requestProvider"));
  request();
  // Bounded re-requests: some extensions register their listener late.
  for (const delay of [50, 150, 400, 1000]) setTimeout(request, delay);
}

export function subscribeProviders(cb: () => void) {
  startProviderDiscovery();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function listDiscoveredProviders(): Eip6963Info[] {
  return [...registry.values()];
}

/** True when a legacy `window.ethereum` global is present right now. */
export function hasLegacyInjected(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

/**
 * Waits (bounded) until any browser wallet provider is observable — either an
 * EIP-6963 announcement or the legacy global. Resolves false on timeout so the
 * caller can show "no wallet detected" instead of a raw RPC error.
 */
export function waitForInjectedProvider(timeoutMs = 1500): Promise<boolean> {
  startProviderDiscovery();
  if (registry.size > 0 || hasLegacyInjected()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (registry.size > 0 || hasLegacyInjected()) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}
