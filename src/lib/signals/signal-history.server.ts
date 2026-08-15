// Filtered + paginated reads of `signal_log` for the admin history table.
import { SIGNAL_TABLE, SignalStorageError } from "./signal-dedupe.server";
import type { SignalLogRow, SignalStatus } from "./signal-types";

export type HistoryFilters = {
  status?: SignalStatus | null;
  type?: string | null;
  token?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
};

export type HistoryPage = {
  rows: SignalLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

const COLUMNS =
  "id,created_at,signal_type,token_address,token_symbol,event_id,tx_hash,status,reason,error,metric,telegram_message_id";

export async function querySignals(f: HistoryFilters = {}): Promise<HistoryPage> {
  const { adminClient } = await import("@/integrations/supabase/admin.server");
  const c = adminClient as unknown as import("@supabase/supabase-js").SupabaseClient;

  const page = Math.max(1, Math.floor(f.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(f.pageSize ?? 25)));
  const start = (page - 1) * pageSize;

  let q = c.from(SIGNAL_TABLE).select(COLUMNS, { count: "exact" });
  if (f.status) q = q.eq("status", f.status);
  if (f.type) q = q.eq("signal_type", f.type);
  if (f.token) q = q.eq("token_address", f.token.toLowerCase());
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", f.to);

  const { data, error, count } = await q.order("created_at", { ascending: false }).range(start, start + pageSize - 1);
  if (error) {
    if (/signal_log|schema cache/i.test(error.message)) throw new SignalStorageError(error.message);
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as unknown as SignalLogRow[], total: count ?? 0, page, pageSize };
}
