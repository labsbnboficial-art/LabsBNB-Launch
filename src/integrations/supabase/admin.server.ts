// Service-role Supabase client with support for a non-reserved secret name.
// The platform reserves the `SUPABASE_` prefix for managed projects; this project
// uses an external Supabase project, so the service-role key is stored as
// LABSBNB_SERVICE_ROLE_KEY (fallback: SUPABASE_SERVICE_ROLE_KEY when managed).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LABSBNB_SERVICE_ROLE_KEY;
}

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

export function hasServiceRole(): boolean {
  return !!(serviceKey() && supabaseUrl());
}

function build() {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) {
    throw new Error(
      "Missing service-role credentials. Add the LABSBNB_SERVICE_ROLE_KEY secret (Supabase → Project Settings → API → service_role).",
    );
  }
  const isOpaque = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  return createClient<Database>(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
        if (isOpaque && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _client: ReturnType<typeof build> | undefined;

export const adminClient = new Proxy({} as ReturnType<typeof build>, {
  get(_t, prop, receiver) {
    if (!_client) _client = build();
    return Reflect.get(_client, prop, receiver);
  },
});
