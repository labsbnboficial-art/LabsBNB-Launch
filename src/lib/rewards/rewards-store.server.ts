// 🎁 Fase 2F — Rewards & Eligibility persistence (service role, server only).
//
// Tables created by `docs/SQL_CREATOR_REWARDS_ELIGIBILITY.md`:
//   • creator_reward_programs               — program definitions (admin managed)
//   • creator_reward_rule_versions          — immutable rule history (§23)
//   • creator_reward_eligibility_snapshots  — append-only evaluations (§9)
//
// Snapshots are NEVER updated nor deleted by the app: idempotency comes from a
// UNIQUE fingerprint plus `ignoreDuplicates` upserts.
import { DEFAULT_REWARD_RULES, type CriterionResult, type EligibilitySnapshotRow, type EvaluationWindow, type RewardProgram, type RewardProgramStatus, type RewardRuleVersion, type RewardRules } from "./rewards-types";
import { validateRewardRules } from "./rewards-rules";

async function db() {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export const PROGRAMS_TABLE = "creator_reward_programs";
export const RULE_VERSIONS_TABLE = "creator_reward_rule_versions";
export const SNAPSHOTS_TABLE = "creator_reward_eligibility_snapshots";

type Ready = { ready: boolean; error: string | null };

async function tableReady(table: string): Promise<Ready> {
  try {
    const c = await db();
    const { error } = await c.from(table).select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ready: false, error: error.message };
    return { ready: true, error: null };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export async function rewardsReady(): Promise<Ready> {
  const programs = await tableReady(PROGRAMS_TABLE);
  if (!programs.ready) return programs;
  return tableReady(SNAPSHOTS_TABLE);
}

/* -------------------------------- programs --------------------------------- */

type ProgramRow = {
  id: string;
  chain_id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  season_id: string | null;
  evaluation_window: string;
  evaluation_start: string | null;
  evaluation_end: string | null;
  rule_version: number;
  rules: unknown;
  created_at: string;
  updated_at: string;
};

function toProgram(r: ProgramRow): RewardProgram {
  let rules: RewardRules;
  try {
    rules = validateRewardRules(typeof r.rules === "string" ? JSON.parse(r.rules) : r.rules);
  } catch {
    rules = DEFAULT_REWARD_RULES;
  }
  return {
    id: r.id,
    chainId: r.chain_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status as RewardProgramStatus,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    seasonId: r.season_id,
    evaluationWindow: r.evaluation_window as EvaluationWindow,
    evaluationStart: r.evaluation_start,
    evaluationEnd: r.evaluation_end,
    ruleVersion: r.rule_version,
    rules,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listPrograms(chainId: number): Promise<RewardProgram[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(PROGRAMS_TABLE)
      .select("*")
      .eq("chain_id", chainId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return (data as ProgramRow[]).map(toProgram);
  } catch {
    return [];
  }
}

export async function getProgramBySlug(chainId: number, slug: string): Promise<RewardProgram | null> {
  try {
    const c = await db();
    const { data, error } = await c.from(PROGRAMS_TABLE).select("*").eq("chain_id", chainId).eq("slug", slug).maybeSingle();
    if (error || !data) return null;
    return toProgram(data as ProgramRow);
  } catch {
    return null;
  }
}

export async function getProgramById(id: string): Promise<RewardProgram | null> {
  try {
    const c = await db();
    const { data, error } = await c.from(PROGRAMS_TABLE).select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return toProgram(data as ProgramRow);
  } catch {
    return null;
  }
}

export async function insertProgram(input: {
  chainId: number;
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  seasonId: string | null;
  evaluationWindow: EvaluationWindow;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  rules: RewardRules;
}): Promise<RewardProgram> {
  const c = await db();
  const { data, error } = await c
    .from(PROGRAMS_TABLE)
    .insert({
      chain_id: input.chainId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      status: "draft",
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      season_id: input.seasonId,
      evaluation_window: input.evaluationWindow,
      evaluation_start: input.evaluationStart,
      evaluation_end: input.evaluationEnd,
      rule_version: 1,
      rules: input.rules,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el programa: ${error?.message ?? "sin datos"}`);
  const program = toProgram(data as ProgramRow);
  await insertRuleVersion(program.id, 1, program.rules, "Versión inicial");
  return program;
}

export async function updateProgram(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    description: string | null;
    status: RewardProgramStatus;
    startsAt: string | null;
    endsAt: string | null;
    seasonId: string | null;
    evaluationWindow: EvaluationWindow;
    evaluationStart: string | null;
    evaluationEnd: string | null;
    ruleVersion: number;
    rules: RewardRules;
  }>,
): Promise<RewardProgram> {
  const c = await db();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row["name"] = patch.name;
  if (patch.slug !== undefined) row["slug"] = patch.slug;
  if (patch.description !== undefined) row["description"] = patch.description;
  if (patch.status !== undefined) row["status"] = patch.status;
  if (patch.startsAt !== undefined) row["starts_at"] = patch.startsAt;
  if (patch.endsAt !== undefined) row["ends_at"] = patch.endsAt;
  if (patch.seasonId !== undefined) row["season_id"] = patch.seasonId;
  if (patch.evaluationWindow !== undefined) row["evaluation_window"] = patch.evaluationWindow;
  if (patch.evaluationStart !== undefined) row["evaluation_start"] = patch.evaluationStart;
  if (patch.evaluationEnd !== undefined) row["evaluation_end"] = patch.evaluationEnd;
  if (patch.ruleVersion !== undefined) row["rule_version"] = patch.ruleVersion;
  if (patch.rules !== undefined) row["rules"] = patch.rules;
  const { data, error } = await c.from(PROGRAMS_TABLE).update(row).eq("id", id).select("*").single();
  if (error || !data) throw new Error(`No se pudo actualizar el programa: ${error?.message ?? "sin datos"}`);
  return toProgram(data as ProgramRow);
}

/* ------------------------------ rule versions ------------------------------ */

type RuleVersionRow = {
  id: string;
  program_id: string;
  version: number;
  rules: unknown;
  note: string | null;
  created_at: string;
};

function toRuleVersion(r: RuleVersionRow): RewardRuleVersion {
  let rules: RewardRules;
  try {
    rules = validateRewardRules(typeof r.rules === "string" ? JSON.parse(r.rules) : r.rules);
  } catch {
    rules = DEFAULT_REWARD_RULES;
  }
  return { id: r.id, programId: r.program_id, version: r.version, rules, note: r.note, createdAt: r.created_at };
}

export async function insertRuleVersion(
  programId: string,
  version: number,
  rules: RewardRules,
  note: string | null,
): Promise<RewardRuleVersion | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(RULE_VERSIONS_TABLE)
      .upsert({ program_id: programId, version, rules, note }, { onConflict: "program_id,version", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error || !data) return null;
    return toRuleVersion(data as RuleVersionRow);
  } catch {
    return null;
  }
}

export async function listRuleVersions(programId: string): Promise<RewardRuleVersion[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(RULE_VERSIONS_TABLE)
      .select("*")
      .eq("program_id", programId)
      .order("version", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return (data as RuleVersionRow[]).map(toRuleVersion);
  } catch {
    return [];
  }
}

/* -------------------------------- snapshots -------------------------------- */

export async function appendEligibilitySnapshots(
  rows: EligibilitySnapshotRow[],
): Promise<{ inserted: number; duplicates: number; error: string | null }> {
  if (!rows.length) return { inserted: 0, duplicates: 0, error: null };
  try {
    const c = await db();
    const payload = rows.map((r) => ({
      chain_id: r.chainId,
      program_id: r.programId,
      rule_version: r.ruleVersion,
      creator_address: r.creatorAddress.toLowerCase(),
      status: r.status,
      eligible: r.eligible,
      eligibility_score: r.eligibilityScore,
      points: r.points,
      creator_score: r.creatorScore,
      creator_level: r.creatorLevel,
      achievements: r.achievements,
      graduations: r.graduations,
      organic_score: r.organicScore,
      season_rank: r.seasonRank,
      criteria_result: r.criteriaResult,
      risk_flags: r.riskFlags,
      evaluation_window: r.evaluationWindow,
      evaluation_start: r.evaluationStart,
      evaluation_end: r.evaluationEnd,
      evaluated_at: r.evaluatedAt,
      fingerprint: r.fingerprint,
    }));
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .upsert(payload, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) return { inserted: 0, duplicates: 0, error: error.message };
    const inserted = data?.length ?? 0;
    return { inserted, duplicates: rows.length - inserted, error: null };
  } catch (e) {
    return { inserted: 0, duplicates: 0, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

export type SnapshotRecord = {
  programId: string;
  creatorAddress: string;
  status: string;
  eligible: boolean;
  eligibilityScore: number;
  ruleVersion: number;
  criteriaResult: CriterionResult[] | null;
  evaluatedAt: string;
};

/** Latest evaluation stored for one creator in one program (immutable read). */
export async function latestSnapshotFor(
  chainId: number,
  programId: string,
  creatorAddress: string,
): Promise<SnapshotRecord | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .select("program_id, creator_address, status, eligible, eligibility_score, rule_version, criteria_result, evaluated_at")
      .eq("chain_id", chainId)
      .eq("program_id", programId)
      .eq("creator_address", creatorAddress.toLowerCase())
      .order("evaluated_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const r = data[0] as Record<string, unknown>;
    return {
      programId: String(r["program_id"]),
      creatorAddress: String(r["creator_address"]),
      status: String(r["status"]),
      eligible: !!r["eligible"],
      eligibilityScore: Number(r["eligibility_score"] ?? 0),
      ruleVersion: Number(r["rule_version"] ?? 1),
      criteriaResult: (r["criteria_result"] as CriterionResult[] | null) ?? null,
      evaluatedAt: String(r["evaluated_at"]),
    };
  } catch {
    return null;
  }
}

export type ProgramStats = {
  evaluated: number;
  eligible: number;
  lastEvaluatedAt: string | null;
};

/** Aggregated public counters of the latest evaluation batch of a program. */
export async function programStats(chainId: number, programId: string): Promise<ProgramStats | null> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .select("creator_address, status, evaluated_at")
      .eq("chain_id", chainId)
      .eq("program_id", programId)
      .order("evaluated_at", { ascending: false })
      .limit(5000);
    if (error || !data?.length) return null;
    const rows = data as { creator_address: string; status: string; evaluated_at: string }[];
    const lastEvaluatedAt = rows[0]?.evaluated_at ?? null;
    const seen = new Set<string>();
    let evaluated = 0;
    let eligible = 0;
    for (const r of rows) {
      if (r.evaluated_at !== lastEvaluatedAt) break;
      if (seen.has(r.creator_address)) continue;
      seen.add(r.creator_address);
      evaluated += 1;
      if (r.status === "eligible") eligible += 1;
    }
    return { evaluated, eligible, lastEvaluatedAt };
  } catch {
    return null;
  }
}

export async function recentSnapshots(chainId: number, programId: string, limit = 50): Promise<SnapshotRecord[]> {
  try {
    const c = await db();
    const { data, error } = await c
      .from(SNAPSHOTS_TABLE)
      .select("program_id, creator_address, status, eligible, eligibility_score, rule_version, criteria_result, evaluated_at")
      .eq("chain_id", chainId)
      .eq("program_id", programId)
      .order("evaluated_at", { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)));
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      programId: String(r["program_id"]),
      creatorAddress: String(r["creator_address"]),
      status: String(r["status"]),
      eligible: !!r["eligible"],
      eligibilityScore: Number(r["eligibility_score"] ?? 0),
      ruleVersion: Number(r["rule_version"] ?? 1),
      criteriaResult: (r["criteria_result"] as CriterionResult[] | null) ?? null,
      evaluatedAt: String(r["evaluated_at"]),
    }));
  } catch {
    return [];
  }
}
