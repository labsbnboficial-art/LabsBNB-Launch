import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * 🚀 Impulso — premium promoted slots on the launchpad home.
 * Purchases are paid in BNB to the treasury wallet and verified on-chain
 * before the boost row is created. Admin writes are gated by the admin session.
 */

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Dirección inválida");
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Hash de transacción inválido");

export type PublicBoost = {
  id: string;
  token_address: string;
  token_name: string | null;
  token_ticker: string | null;
  days: number;
  starts_at: string;
  expires_at: string;
  status: string;
};

/** Everything the public UI needs: settings, plans and live boosted tokens. */
export const getBoostState = createServerFn({ method: "GET" }).handler(async () => {
  const m = await import("@/lib/boost.server");
  try {
    const settings = await m.readSettings();
    await m.expireBoosts();
    const client = await m.db();
    const [{ data: pkgs }, { data: boosts }] = await Promise.all([
      client.from("boost_packages").select("*").eq("active", true).order("sort_order", { ascending: true }),
      client
        .from("token_boosts")
        .select("id,token_address,token_name,token_ticker,days,starts_at,expires_at,status")
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(settings.maxSlots),
    ]);
    const packages = ((pkgs ?? []) as m.PackageRow[]).map((p) => ({
      id: p.id,
      name: p.name,
      days: p.days,
      priceBnb: m.packagePrice(p, settings),
    }));
    return {
      settings,
      packages,
      boosts: (boosts ?? []) as PublicBoost[],
      error: null as string | null,
    };
  } catch (e) {
    return {
      settings: {
        enabled: false,
        pricePerDayBnb: 0.05,
        currency: "BNB",
        wallet: m.DEFAULT_BOOST_WALLET,
        maxSlots: 10,
        autoApprove: true,
        maxDays: 30,
      },
      packages: [] as { id: string; name: string; days: number; priceBnb: number }[],
      boosts: [] as PublicBoost[],
      error: (e as Error).message,
    };
  }
});

/** Quote for a plan (or a custom number of days) without touching the chain. */
export const quoteBoost = createServerFn({ method: "POST" })
  .inputValidator((d: { packageId?: string; days?: number }) =>
    z.object({ packageId: z.string().uuid().optional(), days: z.number().int().min(1).max(365).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const m = await import("@/lib/boost.server");
    const settings = await m.readSettings();
    if (!settings.enabled) throw new Error("El servicio Impulso está desactivado por el administrador.");
    let days = data.days ?? 0;
    let price = 0;
    if (data.packageId) {
      const { data: pkg } = await (await m.db())
        .from("boost_packages").select("*").eq("id", data.packageId).maybeSingle();
      if (!pkg || !pkg.active) throw new Error("Plan no disponible.");
      days = pkg.days;
      price = m.packagePrice(pkg as m.PackageRow, settings);
    } else {
      if (!days) throw new Error("Indica los días de impulso.");
      if (days > settings.maxDays) throw new Error(`Máximo ${settings.maxDays} días por compra.`);
      price = Number((days * settings.pricePerDayBnb).toFixed(8));
    }
    return { days, priceBnb: price, wallet: settings.wallet, currency: settings.currency };
  });

/** Registers a boost after verifying the BNB payment on-chain. */
export const purchaseBoost = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; wallet: string; txHash: string; packageId?: string; days?: number }) =>
    z.object({
      token: addr,
      wallet: addr,
      txHash: hash,
      packageId: z.string().uuid().optional(),
      days: z.number().int().min(1).max(365).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const m = await import("@/lib/boost.server");
    const settings = await m.readSettings();
    if (!settings.enabled) throw new Error("El servicio Impulso está desactivado por el administrador.");
    const client = await m.db();

    // 1) Duplicate payment guard.
    const { data: dup } = await client
      .from("token_boosts").select("id").eq("tx_hash", data.txHash.toLowerCase()).maybeSingle();
    if (dup) throw new Error("Esa transacción ya fue utilizada para otro impulso.");

    // 2) Plan / price.
    let days = data.days ?? 0;
    let price = 0;
    let packageId: string | null = null;
    if (data.packageId) {
      const { data: pkg } = await client.from("boost_packages").select("*").eq("id", data.packageId).maybeSingle();
      if (!pkg || !pkg.active) throw new Error("Plan no disponible.");
      days = pkg.days;
      price = m.packagePrice(pkg as m.PackageRow, settings);
      packageId = pkg.id;
    } else {
      if (!days) throw new Error("Indica los días de impulso.");
      if (days > settings.maxDays) throw new Error(`Máximo ${settings.maxDays} días por compra.`);
      price = Number((days * settings.pricePerDayBnb).toFixed(8));
    }

    // 3) Ownership: only the on-chain creator can boost a token.
    const creator = await m.creatorOf(data.token as `0x${string}`);
    if (creator && creator !== data.wallet.toLowerCase()) {
      throw new Error("Sólo el creador del token puede impulsarlo.");
    }

    // 4) Payment verification.
    const { paid } = await m.verifyPayment({
      txHash: data.txHash as `0x${string}`,
      to: settings.wallet,
      from: data.wallet,
      amountBnb: price,
    });

    // 5) Extend an existing active boost instead of duplicating the slot.
    const now = Date.now();
    const { data: current } = await client
      .from("token_boosts")
      .select("id,expires_at")
      .eq("status", "active")
      .ilike("token_address", data.token)
      .gt("expires_at", new Date(now).toISOString())
      .maybeSingle();
    const base = current ? new Date(current.expires_at).getTime() : now;
    const expiresAt = new Date(base + days * 86_400_000).toISOString();

    const identity = await m.tokenIdentity(data.token as `0x${string}`);
    const { data: tokenRow } = await client
      .from("tokens").select("id,name,ticker").ilike("contract_address", data.token).maybeSingle();

    const row = {
      token_address: data.token.toLowerCase(),
      token_id: tokenRow?.id ?? null,
      token_name: tokenRow?.name ?? identity.name ?? null,
      token_ticker: tokenRow?.ticker ?? identity.ticker ?? null,
      owner_wallet: data.wallet.toLowerCase(),
      package_id: packageId,
      days,
      total_paid: paid,
      currency: settings.currency,
      tx_hash: data.txHash.toLowerCase(),
      status: settings.autoApprove ? "active" : "pending",
      starts_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    };
    const { data: inserted, error } = await client.from("token_boosts").insert(row).select("id,status,expires_at").single();
    if (error) throw new Error(error.message);
    return inserted as { id: string; status: string; expires_at: string };
  });

/* ------------------------------- Admin side ------------------------------- */

const csrfSchema = z.string().min(10);

async function adminDb(csrf: string) {
  const auth = await import("@/lib/admin-auth.server");
  const cur = await auth.requireAdmin(csrf);
  const m = await import("@/lib/boost.server");
  return { client: await m.db(), m, adminId: cur.account.id };
}

export const adminBoostOverview = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string }) => z.object({ csrf: csrfSchema }).parse(d))
  .handler(async ({ data }) => {
    const { client, m } = await adminDb(data.csrf);
    await m.expireBoosts();
    const settings = await m.readSettings();
    const [{ data: pkgs }, { data: boosts }] = await Promise.all([
      client.from("boost_packages").select("*").order("sort_order", { ascending: true }),
      client.from("token_boosts").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    const rows = (boosts ?? []) as (PublicBoost & { total_paid: number; owner_wallet: string; tx_hash: string; created_at: string })[];
    const revenue = rows
      .filter((r) => r.status === "active" || r.status === "finished")
      .reduce((a, r) => a + Number(r.total_paid ?? 0), 0);
    return {
      settings,
      packages: ((pkgs ?? []) as m.PackageRow[]).map((p) => ({ ...p, effectivePrice: m.packagePrice(p, settings) })),
      boosts: rows,
      stats: {
        active: rows.filter((r) => r.status === "active").length,
        pending: rows.filter((r) => r.status === "pending").length,
        revenue: Number(revenue.toFixed(6)),
      },
    };
  });

export const adminSaveBoostSettings = createServerFn({ method: "POST" })
  .inputValidator((d: {
    csrf: string;
    enabled: boolean; pricePerDayBnb: number; wallet: string;
    maxSlots: number; autoApprove: boolean; maxDays: number; currency: string;
  }) =>
    z.object({
      csrf: csrfSchema,
      enabled: z.boolean(),
      pricePerDayBnb: z.number().min(0).max(1000),
      wallet: addr,
      maxSlots: z.number().int().min(1).max(50),
      autoApprove: z.boolean(),
      maxDays: z.number().int().min(1).max(365),
      currency: z.string().min(1).max(8),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { client, adminId } = await adminDb(data.csrf);
    const entries = [
      ["boost_enabled", data.enabled],
      ["boost_price_per_day_bnb", data.pricePerDayBnb],
      ["boost_currency", data.currency],
      ["boost_wallet", data.wallet],
      ["boost_max_slots", data.maxSlots],
      ["boost_auto_approve", data.autoApprove],
      ["boost_max_days", data.maxDays],
    ] as const;
    const { error } = await client
      .from("admin_config")
      .upsert(entries.map(([key, value]) => ({ key, value, is_public: true })), { onConflict: "key" });
    if (error) throw new Error(error.message);
    const auth = await import("@/lib/admin-auth.server");
    await auth.audit("boost.settings", adminId, { wallet: data.wallet, price: data.pricePerDayBnb });
    return { ok: true };
  });

export const adminSaveBoostPackage = createServerFn({ method: "POST" })
  .inputValidator((d: {
    csrf: string; id?: string; name: string; days: number;
    priceBnb: number | null; active: boolean; sortOrder: number;
  }) =>
    z.object({
      csrf: csrfSchema,
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(60),
      days: z.number().int().min(1).max(365),
      priceBnb: z.number().min(0).max(10000).nullable(),
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(999),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { client } = await adminDb(data.csrf);
    const row = {
      name: data.name,
      days: data.days,
      price_bnb: data.priceBnb && data.priceBnb > 0 ? data.priceBnb : null,
      active: data.active,
      sort_order: data.sortOrder,
    };
    const q = data.id
      ? client.from("boost_packages").update(row).eq("id", data.id)
      : client.from("boost_packages").insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteBoostPackage = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; id: string }) =>
    z.object({ csrf: csrfSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { client } = await adminDb(data.csrf);
    const { error } = await client.from("boost_packages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Approve / reject / cancel / extend a boost from the panel. */
export const adminUpdateBoost = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; id: string; action: "approve" | "reject" | "cancel" | "extend"; days?: number }) =>
    z.object({
      csrf: csrfSchema,
      id: z.string().uuid(),
      action: z.enum(["approve", "reject", "cancel", "extend"]),
      days: z.number().int().min(1).max(365).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { client, adminId } = await adminDb(data.csrf);
    const { data: row } = await client.from("token_boosts").select("*").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Impulso no encontrado.");
    const patch: Record<string, unknown> = { approved_by: adminId };
    if (data.action === "approve") {
      patch["status"] = "active";
      patch["starts_at"] = new Date().toISOString();
      patch["expires_at"] = new Date(Date.now() + row.days * 86_400_000).toISOString();
    } else if (data.action === "reject") {
      patch["status"] = "rejected";
    } else if (data.action === "cancel") {
      patch["status"] = "cancelled";
    } else {
      const add = data.days ?? 1;
      const base = Math.max(Date.now(), new Date(row.expires_at).getTime());
      patch["status"] = "active";
      patch["expires_at"] = new Date(base + add * 86_400_000).toISOString();
    }
    const { error } = await client.from("token_boosts").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    const auth = await import("@/lib/admin-auth.server");
    await auth.audit(`boost.${data.action}`, adminId, { id: data.id });
    return { ok: true };
  });

/** Manual boost granted by the admin (promotions, compensations). */
export const adminGrantBoost = createServerFn({ method: "POST" })
  .inputValidator((d: { csrf: string; token: string; days: number }) =>
    z.object({ csrf: csrfSchema, token: addr, days: z.number().int().min(1).max(365) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { client, m, adminId } = await adminDb(data.csrf);
    const identity = await m.tokenIdentity(data.token as `0x${string}`);
    const { data: tokenRow } = await client
      .from("tokens").select("id,name,ticker").ilike("contract_address", data.token).maybeSingle();
    const { error } = await client.from("token_boosts").insert({
      token_address: data.token.toLowerCase(),
      token_id: tokenRow?.id ?? null,
      token_name: tokenRow?.name ?? identity.name ?? null,
      token_ticker: tokenRow?.ticker ?? identity.ticker ?? null,
      owner_wallet: (await m.creatorOf(data.token as `0x${string}`)) ?? "admin",
      days: data.days,
      total_paid: 0,
      tx_hash: `admin-${crypto.randomUUID()}`,
      status: "active",
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + data.days * 86_400_000).toISOString(),
      approved_by: adminId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
