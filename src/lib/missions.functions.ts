import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TASK_CATALOG } from "@/lib/xp";

/**
 * Labs Missions server API.
 *
 * Todas las escrituras pasan por el servidor con el service-role client, tras
 * comprobar que el llamante es el dueño del recurso (creador de la campaña) o
 * la wallet admin. El cliente nunca decide si una tarea está verificada.
 */

type AnyDb = import("@supabase/supabase-js").SupabaseClient;

async function db(): Promise<AnyDb> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  return adminClient as unknown as AnyDb;
}

async function cfg(client: AnyDb): Promise<Record<string, unknown>> {
  const { data } = await client.from("admin_config").select("key,value");
  const map: Record<string, unknown> = {};
  (data ?? []).forEach((r: { key: string; value: unknown }) => {
    map[r.key] = typeof r.value === "string" ? (r.value as string).replace(/^"|"$/g, "") : r.value;
  });
  return map;
}

async function walletOf(client: AnyDb, userId: string): Promise<string> {
  const { data } = await client.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  return String((data as { wallet_address?: string } | null)?.wallet_address ?? "").toLowerCase();
}

async function isAdmin(client: AnyDb, userId: string): Promise<boolean> {
  const c = await cfg(client);
  const admin = String(c.admin_wallet ?? "").toLowerCase();
  if (!admin) return false;
  return (await walletOf(client, userId)) === admin;
}

function missing(err: unknown): boolean {
  const m = (err as { message?: string } | null)?.message ?? "";
  return /does not exist|schema cache|relation/i.test(m);
}

// ------------------------------------------------------------------ reads

export const listMissions = createServerFn({ method: "GET" }).handler(async () => {
  const client = await db();
  const { data, error } = await client
    .from("missions")
    .select("id,title,description,scope,xp,reward_text,starts_at,ends_at,active")
    .eq("active", true)
    .order("scope", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    if (missing(error)) return { missions: [], schemaReady: false as const };
    throw new Error(error.message);
  }
  return { missions: data ?? [], schemaReady: true as const };
});

export const listCampaigns = createServerFn({ method: "GET" })
  .inputValidator((d: { tokenId?: string; creatorId?: string } | undefined) =>
    z.object({ tokenId: z.string().uuid().optional(), creatorId: z.string().uuid().optional() }).partial().parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const client = await db();
    let q = client
      .from("campaigns")
      .select("id,token_id,creator_id,title,description,reward_currency,reward_budget,reward_per_task,max_participants,starts_at,ends_at,status,created_at")
      .order("created_at", { ascending: false })
      .limit(60);
    if (data.tokenId) q = q.eq("token_id", data.tokenId);
    if (data.creatorId) q = q.eq("creator_id", data.creatorId);
    else q = q.neq("status", "draft");
    const { data: rows, error } = await q;
    if (error) {
      if (missing(error)) return { campaigns: [], schemaReady: false as const };
      throw new Error(error.message);
    }
    const ids = (rows ?? []).map((r: { token_id: string | null }) => r.token_id).filter(Boolean) as string[];
    let tokens: Record<string, { name: string; ticker: string; logo_url: string | null }> = {};
    if (ids.length) {
      const { data: tk } = await client.from("tokens").select("id,name,ticker,logo_url").in("id", ids);
      tokens = Object.fromEntries((tk ?? []).map((t) => [String((t as { id: string }).id), t as unknown as { name: string; ticker: string; logo_url: string | null }]));
    }
    return { campaigns: (rows ?? []).map((r: { token_id: string | null }) => ({ ...r, token: r.token_id ? tokens[r.token_id] ?? null : null })), schemaReady: true as const };
  });

export const getCampaign = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const client = await db();
    const { data: campaign, error } = await client.from("campaigns").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campaign not found");
    const { data: tasks } = await client.from("campaign_tasks").select("*").eq("campaign_id", data.id).order("sort");
    const { data: participants } = await client
      .from("campaign_participants")
      .select("user_id,wallet_address,xp_earned,reward_earned,status,joined_at")
      .eq("campaign_id", data.id)
      .order("xp_earned", { ascending: false })
      .limit(100);
    let token = null;
    const tokenId = (campaign as { token_id?: string }).token_id;
    if (tokenId) {
      const { data: tk } = await client.from("tokens").select("id,name,ticker,logo_url,contract_address").eq("id", tokenId).maybeSingle();
      token = tk ?? null;
    }
    return { campaign, tasks: tasks ?? [], participants: participants ?? [], token };
  });

export const getMyMissionState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = await db();
    const [{ data: subs }, { data: xp }] = await Promise.all([
      client.from("task_submissions").select("id,task_id,campaign_id,mission_id,status,proof,created_at").eq("user_id", context.userId),
      client.from("xp_ledger").select("xp,reason,task_id,created_at").eq("user_id", context.userId),
    ]);
    const total = (xp ?? []).reduce((a: number, r: { xp: number }) => a + (r.xp ?? 0), 0);
    return { submissions: subs ?? [], xpTotal: total, entries: xp ?? [] };
  });

export const getXpLeaderboard = createServerFn({ method: "GET" }).handler(async () => {
  const client = await db();
  const { data, error } = await client.from("xp_ledger").select("user_id,xp");
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message);
  }
  const totals = new Map<string, number>();
  (data ?? []).forEach((r: { user_id: string; xp: number }) => totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + (r.xp ?? 0)));
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (!top.length) return [];
  const { data: profs } = await client.from("profiles").select("id,username,wallet_address,avatar_url").in("id", top.map(([id]) => id));
  const byId = Object.fromEntries((profs ?? []).map((p: { id: string }) => [p.id, p]));
  return top.map(([id, xp]) => ({ user_id: id, xp, profile: byId[id] ?? null }));
});

// ------------------------------------------------------------- campaign CRUD

const taskInput = z.object({
  type: z.string().min(1).max(40),
  required: z.boolean().default(true),
  xp: z.number().int().min(0).max(10000).default(10),
  reward: z.number().min(0).default(0),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tokenId: z.string().uuid(),
        title: z.string().trim().min(3).max(80),
        description: z.string().trim().max(600).optional(),
        rewardCurrency: z.enum(["token", "labsbnb", "bnb", "nft", "raffle", "fee_discount"]),
        rewardBudget: z.number().min(0),
        rewardPerTask: z.number().min(0),
        maxParticipants: z.number().int().min(1).max(100000),
        durationHours: z.number().int().min(1).max(24 * 60),
        feeTxHash: z.string().trim().max(80).optional(),
        tasks: z.array(taskInput).min(1).max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = await db();
    const c = await cfg(client);

    const { data: token } = await client.from("tokens").select("id,creator_id").eq("id", data.tokenId).maybeSingle();
    if (!token) throw new Error("Token not found");
    const admin = await isAdmin(client, context.userId);
    if ((token as { creator_id: string | null }).creator_id !== context.userId && !admin) {
      throw new Error("Solo el creador del token puede lanzar una campaña");
    }

    const minR = Number(c.campaign_min_reward ?? 0);
    const maxR = Number(c.campaign_max_reward ?? Number.MAX_SAFE_INTEGER);
    if (data.rewardPerTask < minR || data.rewardPerTask > maxR) {
      throw new Error(`La recompensa por tarea debe estar entre ${minR} y ${maxR}`);
    }
    const maxP = Number(c.campaign_max_participants ?? 5000);
    if (data.maxParticipants > maxP) throw new Error(`Máximo de participantes permitido: ${maxP}`);

    // Comisión por crear campaña (BNB a la wallet admin), verificada on-chain.
    const feeWei = BigInt(String(c.campaign_fee_bnb ?? "0") || "0");
    if (feeWei > 0n && !admin) {
      if (!data.feeTxHash) throw new Error("Falta el pago de la comisión de campaña");
      await verifyFeePayment({
        hash: data.feeTxHash,
        rpc: String(c.rpc_url ?? ""),
        to: String(c.admin_wallet ?? ""),
        minValue: feeWei,
      });
      const { data: dup } = await client.from("campaigns").select("id").eq("fee_tx_hash", data.feeTxHash).maybeSingle();
      if (dup) throw new Error("Ese pago ya fue usado en otra campaña");
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + data.durationHours * 3600_000);
    const { data: created, error } = await client
      .from("campaigns")
      .insert({
        token_id: data.tokenId,
        creator_id: context.userId,
        title: data.title,
        description: data.description ?? null,
        reward_currency: data.rewardCurrency,
        reward_budget: data.rewardBudget,
        reward_per_task: data.rewardPerTask,
        max_participants: data.maxParticipants,
        duration_hours: data.durationHours,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "active",
        fee_tx_hash: data.feeTxHash ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const campaignId = (created as { id: string }).id;
    const rows = data.tasks.map((t, i) => {
      const spec = TASK_CATALOG.find((s) => s.type === t.type);
      const reviewMode = String(c.campaign_review_mode ?? "manual");
      return {
        campaign_id: campaignId,
        type: t.type,
        label: spec?.label ?? t.type,
        required: t.required,
        xp: t.xp || spec?.xp || 10,
        reward: t.reward,
        params: t.params,
        verification: spec?.verification === "auto" && reviewMode !== "manual_all" ? "auto" : spec?.verification ?? "manual",
        sort: i,
      };
    });
    const { error: te } = await client.from("campaign_tasks").insert(rows);
    if (te) throw new Error(te.message);

    await client.from("activity").insert({
      kind: "campaign_created",
      token_id: data.tokenId,
      user_id: context.userId,
      payload: { campaign_id: campaignId, title: data.title },
    });

    return { id: campaignId };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["active", "ended", "cancelled"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: camp } = await client.from("campaigns").select("creator_id").eq("id", data.id).maybeSingle();
    if (!camp) throw new Error("Campaign not found");
    if ((camp as { creator_id: string | null }).creator_id !== context.userId && !(await isAdmin(client, context.userId))) {
      throw new Error("Forbidden");
    }
    const { error } = await client.from("campaigns").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------------------- participation

export const joinCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: camp } = await client.from("campaigns").select("id,status,max_participants,ends_at").eq("id", data.campaignId).maybeSingle();
    if (!camp) throw new Error("Campaign not found");
    const c = camp as { status: string; max_participants: number; ends_at: string | null };
    if (c.status !== "active") throw new Error("La campaña no está activa");
    if (c.ends_at && new Date(c.ends_at) < new Date()) throw new Error("La campaña ha terminado");

    const { count } = await client
      .from("campaign_participants")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    if ((count ?? 0) >= c.max_participants) throw new Error("Cupo de participantes completo");

    const wallet = await walletOf(client, context.userId);
    const conf = await cfg(client);
    if (conf.antifraud_one_per_wallet !== false && wallet) {
      const { data: dupe } = await client
        .from("campaign_participants")
        .select("user_id")
        .eq("campaign_id", data.campaignId)
        .eq("wallet_address", wallet)
        .maybeSingle();
      if (dupe && (dupe as { user_id: string }).user_id !== context.userId) {
        throw new Error("Esa wallet ya participa en la campaña");
      }
    }

    const { error } = await client
      .from("campaign_participants")
      .upsert({ campaign_id: data.campaignId, user_id: context.userId, wallet_address: wallet || null }, { onConflict: "campaign_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ taskId: z.string().uuid(), proof: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: task } = await client.from("campaign_tasks").select("*").eq("id", data.taskId).maybeSingle();
    if (!task) throw new Error("Task not found");
    const t = task as {
      id: string; campaign_id: string | null; mission_id: string | null; type: string;
      xp: number; verification: string; params: Record<string, unknown>;
    };

    const { data: existing } = await client
      .from("task_submissions")
      .select("id,status")
      .eq("task_id", t.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing && ["approved", "auto_verified"].includes((existing as { status: string }).status)) {
      return { status: (existing as { status: string }).status };
    }

    let tokenId: string | null = null;
    if (t.campaign_id) {
      const { data: camp } = await client.from("campaigns").select("token_id,status").eq("id", t.campaign_id).maybeSingle();
      if ((camp as { status?: string } | null)?.status !== "active") throw new Error("La campaña no está activa");
      tokenId = (camp as { token_id: string | null }).token_id;
    }

    let status: "pending" | "auto_verified" = "pending";
    let reason: string | null = null;
    if (t.verification === "auto") {
      const res = await autoVerify(client, { type: t.type, params: t.params ?? {}, userId: context.userId, tokenId });
      if (!res.ok) throw new Error(res.reason);
      status = "auto_verified";
      reason = res.reason;
    } else if (!data.proof) {
      throw new Error("Adjunta la prueba (enlace o usuario) para revisión");
    }

    const wallet = await walletOf(client, context.userId);
    const { error } = await client.from("task_submissions").upsert(
      {
        task_id: t.id,
        campaign_id: t.campaign_id,
        mission_id: t.mission_id,
        user_id: context.userId,
        wallet_address: wallet || null,
        proof: data.proof ?? null,
        status,
        reason,
      },
      { onConflict: "task_id,user_id" },
    );
    if (error) throw new Error(error.message);

    if (status === "auto_verified") await grantXp(client, context.userId, t.id, t.xp, `task:${t.type}`);
    return { status };
  });

export const listCampaignSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: camp } = await client.from("campaigns").select("creator_id").eq("id", data.campaignId).maybeSingle();
    if (!camp) throw new Error("Campaign not found");
    if ((camp as { creator_id: string | null }).creator_id !== context.userId && !(await isAdmin(client, context.userId))) {
      throw new Error("Forbidden");
    }
    const { data: subs } = await client
      .from("task_submissions")
      .select("id,task_id,user_id,wallet_address,proof,status,created_at")
      .eq("campaign_id", data.campaignId)
      .order("created_at", { ascending: false })
      .limit(300);
    const { data: tasks } = await client.from("campaign_tasks").select("id,type,label,xp,reward").eq("campaign_id", data.campaignId);
    return { submissions: subs ?? [], tasks: tasks ?? [] };
  });

export const reviewSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ submissionId: z.string().uuid(), approve: z.boolean(), reason: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: sub } = await client
      .from("task_submissions")
      .select("id,task_id,user_id,campaign_id,status")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (!sub) throw new Error("Submission not found");
    const s = sub as { id: string; task_id: string; user_id: string; campaign_id: string | null };

    if (s.campaign_id) {
      const { data: camp } = await client.from("campaigns").select("creator_id").eq("id", s.campaign_id).maybeSingle();
      if ((camp as { creator_id?: string } | null)?.creator_id !== context.userId && !(await isAdmin(client, context.userId))) {
        throw new Error("Forbidden");
      }
    } else if (!(await isAdmin(client, context.userId))) {
      throw new Error("Forbidden");
    }

    const { error } = await client
      .from("task_submissions")
      .update({
        status: data.approve ? "approved" : "rejected",
        reason: data.reason ?? null,
        reviewer_id: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", s.id);
    if (error) throw new Error(error.message);

    if (data.approve) {
      const { data: task } = await client.from("campaign_tasks").select("xp,reward,type").eq("id", s.task_id).maybeSingle();
      const t = task as { xp: number; reward: number; type: string } | null;
      if (t) {
        await grantXp(client, s.user_id, s.task_id, t.xp, `task:${t.type}`);
        if (s.campaign_id && t.reward) {
          const { data: part } = await client
            .from("campaign_participants")
            .select("id,reward_earned")
            .eq("campaign_id", s.campaign_id)
            .eq("user_id", s.user_id)
            .maybeSingle();
          if (part) {
            await client
              .from("campaign_participants")
              .update({ reward_earned: Number((part as { reward_earned: number }).reward_earned ?? 0) + Number(t.reward) })
              .eq("id", (part as { id: string }).id);
          }
        }
      }
      await client.from("activity").insert({
        kind: "notification",
        user_id: s.user_id,
        payload: { title: "Tarea aprobada", body: "Has recibido XP por una tarea de Labs Missions." },
      });
    }
    return { ok: true };
  });

export const claimMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const client = await db();
    const { data: mission } = await client.from("missions").select("id,xp,scope,active").eq("id", data.missionId).maybeSingle();
    if (!mission) throw new Error("Mission not found");
    const m = mission as { id: string; xp: number; scope: string; active: boolean };
    if (!m.active) throw new Error("Misión no disponible");

    const now = new Date();
    const period =
      m.scope === "daily"
        ? now.toISOString().slice(0, 10)
        : m.scope === "weekly"
          ? `${now.getUTCFullYear()}-w${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`
          : "once";
    const reason = `mission:${m.id}:${period}`;

    const { data: dup } = await client.from("xp_ledger").select("id").eq("user_id", context.userId).eq("reason", reason).maybeSingle();
    if (dup) return { ok: true, already: true, xp: 0 };

    const { error } = await client.from("xp_ledger").insert({ user_id: context.userId, xp: m.xp, reason });
    if (error) throw new Error(error.message);
    return { ok: true, already: false, xp: m.xp };
  });

// ----------------------------------------------------------------- internals

async function grantXp(client: AnyDb, userId: string, taskId: string, xp: number, reason: string) {
  const { data: dup } = await client.from("xp_ledger").select("id").eq("user_id", userId).eq("task_id", taskId).maybeSingle();
  if (dup) return;
  await client.from("xp_ledger").insert({ user_id: userId, task_id: taskId, xp, reason });
  const { data: sub } = await client.from("task_submissions").select("campaign_id").eq("task_id", taskId).eq("user_id", userId).maybeSingle();
  const campaignId = (sub as { campaign_id: string | null } | null)?.campaign_id;
  if (campaignId) {
    const { data: part } = await client
      .from("campaign_participants")
      .select("id,xp_earned")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .maybeSingle();
    if (part) {
      await client
        .from("campaign_participants")
        .update({ xp_earned: Number((part as { xp_earned: number }).xp_earned ?? 0) + xp })
        .eq("id", (part as { id: string }).id);
    } else {
      await client.from("campaign_participants").insert({ campaign_id: campaignId, user_id: userId, xp_earned: xp });
    }
  }
}

async function autoVerify(
  client: AnyDb,
  args: { type: string; params: Record<string, unknown>; userId: string; tokenId: string | null },
): Promise<{ ok: boolean; reason: string }> {
  const { type, params, userId, tokenId } = args;
  switch (type) {
    case "buy_min": {
      if (!tokenId) return { ok: false, reason: "Campaña sin token asociado" };
      const min = Number(params.min_bnb ?? 0);
      const { data } = await client
        .from("trades")
        .select("amount_bnb")
        .eq("token_id", tokenId)
        .eq("user_id", userId)
        .eq("side", "buy");
      const total = (data ?? []).reduce((a: number, r: { amount_bnb: number }) => a + Number(r.amount_bnb ?? 0), 0);
      return total >= min
        ? { ok: true, reason: `Compras verificadas: ${total} BNB` }
        : { ok: false, reason: `Necesitas comprar al menos ${min} BNB (llevas ${total})` };
    }
    case "hold": {
      if (!tokenId) return { ok: false, reason: "Campaña sin token asociado" };
      const hours = Number(params.hours ?? 24);
      const { data: buys } = await client
        .from("trades")
        .select("created_at")
        .eq("token_id", tokenId)
        .eq("user_id", userId)
        .eq("side", "buy")
        .order("created_at", { ascending: true })
        .limit(1);
      const first = (buys ?? [])[0] as { created_at: string } | undefined;
      if (!first) return { ok: false, reason: "Aún no has comprado el token" };
      const { data: sells } = await client
        .from("trades")
        .select("id")
        .eq("token_id", tokenId)
        .eq("user_id", userId)
        .eq("side", "sell")
        .limit(1);
      if ((sells ?? []).length) return { ok: false, reason: "Has vendido el token durante el periodo de hold" };
      const elapsed = (Date.now() - new Date(first.created_at).getTime()) / 3600_000;
      return elapsed >= hours
        ? { ok: true, reason: `Hold verificado (${Math.floor(elapsed)}h)` }
        : { ok: false, reason: `Faltan ${Math.ceil(hours - elapsed)}h de hold` };
    }
    case "favorite": {
      if (!tokenId) return { ok: false, reason: "Campaña sin token asociado" };
      const { data } = await client.from("favorites").select("token_id").eq("token_id", tokenId).eq("user_id", userId).maybeSingle();
      return data ? { ok: true, reason: "Token en favoritos" } : { ok: false, reason: "Añade el token a favoritos primero" };
    }
    case "comment": {
      if (!tokenId) return { ok: false, reason: "Campaña sin token asociado" };
      const { data } = await client.from("comments").select("id").eq("token_id", tokenId).eq("user_id", userId).limit(1);
      return (data ?? []).length ? { ok: true, reason: "Comentario verificado" } : { ok: false, reason: "Deja un comentario en la página del proyecto" };
    }
    case "profile": {
      const { data } = await client.from("profiles").select("username,bio,avatar_url,wallet_address").eq("id", userId).maybeSingle();
      const p = (data ?? {}) as { username?: string; bio?: string; avatar_url?: string; wallet_address?: string };
      const done = !!p.username && !!p.bio && !!p.wallet_address;
      return done ? { ok: true, reason: "Perfil completo" } : { ok: false, reason: "Completa username, bio y wallet en tu perfil" };
    }
    case "vote": {
      const { data } = await client.from("activity").select("id").eq("user_id", userId).eq("kind", "vote").eq("token_id", tokenId).limit(1);
      return (data ?? []).length ? { ok: true, reason: "Voto verificado" } : { ok: false, reason: "Vota el proyecto primero" };
    }
    case "referral": {
      const need = Number(params.count ?? 1);
      const wallet = await walletOf(client, userId);
      const { data } = await client.from("activity").select("payload").eq("kind", "referral").limit(500);
      const n = (data ?? []).filter((r: { payload: unknown }) => {
        const ref = (r.payload as { referrer?: string } | null)?.referrer ?? "";
        return String(ref).toLowerCase() === wallet && !!wallet;
      }).length;
      return n >= need ? { ok: true, reason: `${n} referidos verificados` } : { ok: false, reason: `Necesitas ${need} referidos (llevas ${n})` };
    }
    default:
      return { ok: false, reason: "Esta tarea requiere revisión manual" };
  }
}

async function verifyFeePayment(args: { hash: string; rpc: string; to: string; minValue: bigint }) {
  if (!args.rpc || !args.to) throw new Error("Config incompleta: falta rpc_url o admin_wallet");
  const { createPublicClient, http } = await import("viem");
  const clientRpc = createPublicClient({ transport: http(args.rpc) });
  const receipt = await clientRpc.getTransactionReceipt({ hash: args.hash as `0x${string}` }).catch(() => null);
  if (!receipt || receipt.status !== "success") throw new Error("El pago de la campaña no está confirmado");
  const tx = await clientRpc.getTransaction({ hash: args.hash as `0x${string}` }).catch(() => null);
  if (!tx) throw new Error("No se pudo leer la transacción de pago");
  if (String(tx.to ?? "").toLowerCase() !== args.to.toLowerCase()) throw new Error("El pago no se envió a la wallet admin");
  if ((tx.value ?? 0n) < args.minValue) throw new Error("El importe pagado es inferior a la comisión de campaña");
}
