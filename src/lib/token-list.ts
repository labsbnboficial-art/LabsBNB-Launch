import { supabase } from "@/integrations/supabase/client";
import { fetchFactoryTokens, type CurveMetrics } from "@/lib/web3/onchain-token";
import { tokenMediaUrl } from "@/lib/media-url";

export type LaunchToken = {
  id: string;
  name: string;
  ticker: string;
  logo_url: string | null;
  contract_address: string;
  status: string;
  created_at: string | null;
  metrics: CurveMetrics | null;
  curve: `0x${string}` | null;
};

function imageFromMetadata(uri: string | null): string | null {
  if (!uri || !/^https?:\/\//i.test(uri)) return null;
  return /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(uri) || uri.includes("/storage/v1/object/public/") ? uri : null;
}

/** Factory is the source of truth; public database rows only enrich its metadata. */
export async function fetchLaunchTokens(limit = 50): Promise<LaunchToken[]> {
  const [chain, dbResult] = await Promise.all([
    fetchFactoryTokens(limit),
    supabase
      .from("tokens")
      .select("id,name,ticker,logo_url,contract_address,status,created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  const dbRows = dbResult.data ?? [];
  const byAddress = new Map(
    dbRows
      .filter((row) => row.contract_address)
      .map((row) => [String(row.contract_address).toLowerCase(), row]),
  );
  const used = new Set<string>();
  const onchain = chain.map((token) => {
    const db = byAddress.get(token.address.toLowerCase());
    if (db) used.add(db.id);
    return {
      id: db?.id ?? token.address,
      name: db?.name || token.name,
      ticker: db?.ticker || token.ticker,
      logo_url: tokenMediaUrl(db?.logo_url || imageFromMetadata(token.metadataURI)),
      contract_address: token.address,
      status: db?.status ?? "on-chain",
      created_at: db?.created_at ?? null,
      metrics: token.metrics,
      curve: token.curve,
    } satisfies LaunchToken;
  });
  const dbOnly = dbRows
    .filter((row) => !used.has(row.id) && row.contract_address)
    .map((row) => ({
      ...row,
      contract_address: String(row.contract_address),
      metrics: null,
      curve: null,
    } satisfies LaunchToken));
  return [...onchain, ...dbOnly];
}