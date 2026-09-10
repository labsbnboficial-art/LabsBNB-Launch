// TEMPORARY validation script for Fase 2F (deleted after the run).
// Uses the same server modules the Admin panel calls, no fake data.
import { ACTIVE_CHAIN_ID } from "@/lib/web3/networks";
import * as store from "@/lib/rewards/rewards-store.server";
import { runRewardsEngine, evaluateProgram, resetRewardsCache } from "@/lib/rewards/rewards-engine.server";
import { slugify } from "@/lib/rewards/rewards-rules";
import { DEFAULT_REWARD_RULES, type RewardRules } from "@/lib/rewards/rewards-types";

const NAME = "LabsBNB Creator Rewards — Eligibility Test";

const TEST_RULES: RewardRules = {
  criteria: {
    points: { enabled: true, minimum: 0, required: true, weight: 20 },
    score: { enabled: true, minimum: 0, required: false, weight: 20 },
    level: { enabled: true, minimum: 1, required: false, weight: 15 },
    achievements: { enabled: true, minimum: 0, required: false, weight: 15 },
    graduations: { enabled: true, minimum: 0, required: false, weight: 15 },
    organic: { enabled: true, minimum: 0, required: false, weight: 15 },
    seasonRank: { enabled: false, minimum: null, required: false, weight: 0 },
  },
  exclusions: {
    selfTradeDetected: false,
    circularActivity: false,
    nonOrganicActivity: false,
    requireSeasonParticipation: false,
    blockedCreators: [],
  },
};

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  void DEFAULT_REWARD_RULES;
  log("CHAIN", ACTIVE_CHAIN_ID);
  log("READY", await store.rewardsReady());

  const slug = slugify(NAME);
  let program = await store.getProgramBySlug(ACTIVE_CHAIN_ID, slug);
  if (!program) {
    program = await store.insertProgram({
      chainId: ACTIVE_CHAIN_ID,
      name: NAME,
      slug,
      description: "Programa técnico de validación. No otorga ni promete recompensas.",
      startsAt: null,
      endsAt: null,
      seasonId: null,
      evaluationWindow: "current",
      evaluationStart: null,
      evaluationEnd: null,
      rules: TEST_RULES,
    });
    log("PROGRAM CREATED", program.id, program.slug);
  } else {
    log("PROGRAM EXISTS", program.id, program.slug, program.status);
  }
  if (program.status !== "active") {
    program = await store.updateProgram(program.id, { status: "active" });
    log("PROGRAM ACTIVATED");
  }

  resetRewardsCache();
  const dry = await runRewardsEngine("manual-validation", { dryRun: true });
  log("DRY RUN", JSON.stringify(dry, null, 2));

  const { evaluations, window } = await evaluateProgram(program);
  log("WINDOW", JSON.stringify(window));
  for (const e of evaluations) {
    log("---", e.address, e.status, "score", e.eligibilityScore);
    log("   metrics", JSON.stringify(e.metrics));
    log("   criteria", JSON.stringify(e.criteria.map((c) => [c.key, c.status, c.value, c.target, c.required])));
    log("   missing", JSON.stringify(e.missingCriteria), "exclusions", JSON.stringify(e.exclusionReasons));
  }

  const real1 = await runRewardsEngine("manual-validation", {});
  log("REAL RUN 1", JSON.stringify(real1.state, null, 2));

  const real2 = await runRewardsEngine("manual-validation", {});
  log("REAL RUN 2", JSON.stringify(real2.state, null, 2));

  const snaps = await store.recentSnapshots(ACTIVE_CHAIN_ID, program.id, 50);
  log("SNAPSHOT ROWS", snaps.length);
  log(JSON.stringify(snaps.map((s) => [s.creatorAddress, s.status, s.eligibilityScore, s.evaluatedAt]), null, 2));
  log("STATS", JSON.stringify(await store.programStats(ACTIVE_CHAIN_ID, program.id)));
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
