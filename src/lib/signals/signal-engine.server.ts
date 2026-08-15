// LabsBNB Signal Engine — orchestration.
//
//   load configuration → load REAL market data → evaluate rules → dedupe →
//   dispatch → persist history → return summary
//
// The engine is stateless between runs: every decision is derived from on-chain
// data plus `signal_log`, so the same run can be repeated safely (idempotent).
// There is no polling loop and no setInterval: execution is triggered by the
// admin button or by an external cron hitting /api/public/signals/run.
import { listMarketTokens, getTokenMarketData, selectors } from "@/lib/launchpad/market-data";
import { fetchTradeEvents, type TradeEvent } from "@/lib/web3/curve-events";
import type { TokenMarketData } from "@/lib/launchpad/types";
import type { SignalCandidate, SignalConfig, SignalRunResult, SignalType } from "./signal-types";
import {
  analyzeVolume,
  athCandidate,
  bondingCandidate,
  graduationCandidate,
  kingCandidate,
  newTokenCandidate,
  volumeCandidate,
  whaleCandidates,
} from "./signal-rules.server";
import {
  SignalStorageError,
  cooldownActive,
  highestMetric,
  isFirstRun,
  lastSent,
  recordBaseline,
  recordSkip,
  storageReady,
} from "./signal-dedupe.server";
import { dispatchSignal, type DispatchResult } from "./signal-dispatcher.server";
import { loadConfig, loadState, saveState, type SignalEngineState } from "./signal-config.server";

const HISTORY_TYPES: SignalType[] = ["NEW_ATH", "VOLUME_SPIKE", "WHALE_BUY", "WHALE_SELL"];
const SEND_GAP_MS = 1200; // sequential dispatch, well under Telegram's limits.

function cooldownFor(cfg: SignalConfig, type: SignalType): number {
  switch (type) {
    case "VOLUME_SPIKE": return cfg.volume_cooldown_min;
    case "WHALE_BUY":
    case "WHALE_SELL": return cfg.whale_cooldown_min;
    case "NEW_ATH": return cfg.ath_cooldown_min;
    case "KING_OF_THE_HILL": return cfg.koth_cooldown_min;
    case "NEW_TOKEN": return cfg.new_token_cooldown_min;
    case "GRADUATION": return cfg.graduation_cooldown_min;
    default: return 0;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RunOptions = {
  trigger?: string;
  baseUrl?: string;
};

/** Builds every candidate the real data currently justifies (no invention). */
export async function detectCandidates(
  tokens: TokenMarketData[],
  cfg: SignalConfig,
  notes: string[],
): Promise<SignalCandidate[]> {
  const out: SignalCandidate[] = [];
  const needHistory = HISTORY_TYPES.some((t) => cfg.enabled[t]);

  // King of the Hill is a single global winner.
  let kingAddress: string | null = null;
  if (cfg.enabled.KING_OF_THE_HILL) {
    // Same selector the King of the Hill section uses — one source of truth.
    const king = selectors.king(tokens);
    kingAddress = king ? king.address.toLowerCase() : null;
  }

  for (const token of tokens) {
    if (cfg.enabled.NEW_TOKEN) out.push(newTokenCandidate(token));

    if (cfg.enabled.GRADUATION) {
      const g = graduationCandidate(token);
      if (g) out.push(g);
    }

    if (cfg.enabled.KING_OF_THE_HILL && kingAddress === token.address.toLowerCase()) {
      out.push(kingCandidate(token));
    }

    if (cfg.enabled.BONDING_PROGRESS) {
      const highest = await highestMetric("BONDING_PROGRESS", token.address);
      const b = bondingCandidate(token, cfg, highest);
      if (b) out.push(b);
    }

    if (!needHistory || !token.curve) continue;

    let events: TradeEvent[] = [];
    try {
      events = await fetchTradeEvents(token.curve);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "RPC error";
      notes.push(`${token.symbol}: no se pudo leer el historial on-chain (${msg}).`);
      console.error(`[SIGNAL_ENGINE] trade history failed for ${token.address}: ${msg}`);
      continue;
    }
    if (!events.length) continue;

    if (cfg.enabled.NEW_ATH) {
      const lastAth = await highestMetric("NEW_ATH", token.address);
      const a = athCandidate(token, events, cfg, lastAth);
      if (a) out.push(a);
      else
        await recordSkip(
          { type: "NEW_ATH", tokenAddress: token.address, eventId: "scan", metric: null, txHash: null },
          "threshold-not-reached",
          token.symbol,
        );
    }

    if (cfg.enabled.VOLUME_SPIKE) {
      const analysis = analyzeVolume(events, cfg);
      if (analysis.ok) out.push(volumeCandidate(token, analysis, cfg));
      else
        await recordSkip(
          { type: "VOLUME_SPIKE", tokenAddress: token.address, eventId: "scan", metric: null, txHash: null },
          analysis.reason,
          token.symbol,
        );
    }

    if (cfg.enabled.WHALE_BUY || cfg.enabled.WHALE_SELL) {
      whaleCandidates(token, events, cfg).forEach((c) => {
        if (cfg.enabled[c.type]) out.push(c);
      });
    }
  }

  return out;
}

export async function runSignalEngine(opts: RunOptions = {}): Promise<SignalRunResult> {
  const ranAt = new Date().toISOString();
  const notes: string[] = [];
  const trigger = opts.trigger ?? "manual";
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let detected = 0;
  let tokensScanned = 0;
  let lastError: string | null = null;

  const cfg = await loadConfig();
  console.info(`[SIGNAL_ENGINE] run start trigger=${trigger} enabled=${cfg.engine_enabled}`);

  const persist = async (successful: boolean) => {
    const prev = await loadState().catch(() => null);
    const state: SignalEngineState = {
      lastRunAt: ranAt,
      lastSuccessAt: successful ? ranAt : (prev?.lastSuccessAt ?? null),
      lastTrigger: trigger,
      detected,
      sent,
      skipped,
      failed,
      tokensScanned,
      lastError,
      notes: notes.slice(0, 20),
    };
    await saveState(state);
  };

  const storage = await storageReady();
  if (!storage.ready) {
    lastError = `Almacenamiento de señales no disponible: ${storage.error ?? "tabla signal_log inexistente"}. Aplica docs/SQL_SIGNALS.md.`;
    notes.push(lastError);
    console.error(`[SIGNAL_ENGINE] ${lastError}`);
    await persist(false).catch(() => {});
    return { ranAt, engineEnabled: cfg.engine_enabled, tokensScanned, detected, sent, skipped, failed, notes };
  }

  if (!cfg.engine_enabled) {
    notes.push("Motor deshabilitado: no se evaluaron señales ni se publicó nada.");
    await persist(true);
    return { ranAt, engineEnabled: false, tokensScanned, detected, sent, skipped, failed, notes };
  }

  try {
    const tokens = await listMarketTokens(cfg.scan_tokens);
    tokensScanned = tokens.length;
    if (!tokens.length) notes.push("El Factory no devolvió tokens: nada que evaluar.");

    const candidates = await detectCandidates(tokens, cfg, notes);
    detected = candidates.length;
    candidates.forEach((c) =>
      console.info(`[SIGNAL_DETECTED] ${c.type} ${c.tokenAddress} metric=${c.metric ?? "n/a"}`),
    );

    const symbolOf = new Map(tokens.map((t) => [t.address.toLowerCase(), t.symbol] as const));

    // First ever run: record a baseline instead of blasting the whole history.
    if (await isFirstRun()) {
      for (const c of candidates) {
        await recordBaseline(c, symbolOf.get(c.tokenAddress.toLowerCase()) ?? null);
        skipped += 1;
      }
      notes.push("Primera ejecución: historial registrado como baseline, sin publicar (anti-spam).");
      await persist(true);
      return { ranAt, engineEnabled: true, tokensScanned, detected, sent, skipped, failed, notes };
    }

    const results: DispatchResult[] = [];
    for (const candidate of candidates) {
      if (sent >= cfg.max_sends_per_run) {
        await recordSkip(candidate, "send-budget", symbolOf.get(candidate.tokenAddress.toLowerCase()) ?? null);
        skipped += 1;
        continue;
      }

      const minutes = cooldownFor(cfg, candidate.type);
      if (minutes > 0) {
        const last = await lastSent(candidate.type, candidate.tokenAddress);
        if (cooldownActive(last, minutes)) {
          await recordSkip(candidate, "cooldown", symbolOf.get(candidate.tokenAddress.toLowerCase()) ?? null);
          skipped += 1;
          continue;
        }
      }

      const r = await dispatchSignal(candidate, {
        symbol: symbolOf.get(candidate.tokenAddress.toLowerCase()) ?? null,
        baseUrl: opts.baseUrl,
      });
      results.push(r);
      if (r.status === "sent") sent += 1;
      else if (r.status === "failed") {
        failed += 1;
        lastError = r.error ?? lastError;
      } else skipped += 1;

      if (r.status === "sent") await sleep(SEND_GAP_MS);
    }

    if (!results.some((r) => r.status === "sent")) {
      notes.push("No hubo eventos elegibles que superasen los umbrales en esta ejecución.");
    }

    await persist(true);
    console.info(`[SIGNAL_ENGINE] run done sent=${sent} skipped=${skipped} failed=${failed}`);
    return { ranAt, engineEnabled: true, tokensScanned, detected, sent, skipped, failed, notes };
  } catch (e) {
    const message =
      e instanceof SignalStorageError
        ? `Tabla signal_log no disponible: ${e.message}. Aplica docs/SQL_SIGNALS.md.`
        : e instanceof Error
          ? e.message
          : "Error desconocido en el motor de señales.";
    lastError = message;
    notes.push(message);
    console.error(`[SIGNAL_ENGINE] run failed: ${message}`);
    await persist(false).catch(() => {});
    return { ranAt, engineEnabled: cfg.engine_enabled, tokensScanned, detected, sent, skipped, failed, notes };
  }
}

/** Builds one candidate for the admin PREVIEW. Never publishes anything. */
export async function buildPreviewCandidate(type: SignalType, address: string): Promise<SignalCandidate | null> {
  const cfg = await loadConfig();
  const token = await getTokenMarketData(address, { withHistory: true });
  if (!token) return null;

  switch (type) {
    case "NEW_TOKEN": return newTokenCandidate(token);
    case "KING_OF_THE_HILL": return kingCandidate(token);
    case "GRADUATION":
      return (
        graduationCandidate(token) ?? {
          ...kingCandidate(token),
          type: "GRADUATION",
          eventId: `${token.address.toLowerCase()}:graduated`,
        }
      );
    case "BONDING_PROGRESS":
      return (
        bondingCandidate(token, cfg, null) ?? {
          ...kingCandidate(token),
          type: "BONDING_PROGRESS",
          eventId: `${token.address.toLowerCase()}:milestone:preview`,
          data: { ...kingCandidate(token).data, previousMilestone: null },
        }
      );
    default: break;
  }

  if (!token.curve) return null;
  const events = await fetchTradeEvents(token.curve);
  if (type === "NEW_ATH") return athCandidate(token, events, cfg, null);
  if (type === "VOLUME_SPIKE") {
    const a = analyzeVolume(events, cfg);
    return a.ok ? volumeCandidate(token, a, cfg) : null;
  }
  const whales = whaleCandidates(token, events, cfg, Date.now());
  return whales.find((w) => w.type === type) ?? null;
}
