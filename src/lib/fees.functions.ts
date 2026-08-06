import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Admin-only on-chain fee dashboard (see src/lib/fees.server.ts). */
export const getFeeDashboard = createServerFn({ method: "POST" })
  .inputValidator((data: { csrf: string; factory?: string }) =>
    z.object({ csrf: z.string().min(10), factory: z.string().optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const cfg = await import("@/lib/config.server");
    await cfg.requireConfigAdmin(data.csrf);
    const m = await import("@/lib/fees.server");
    try {
      return { ok: true as const, data: await m.buildFeeDashboard(data.factory), error: null as string | null };
    } catch (e) {
      return { ok: false as const, data: null, error: (e as Error).message };
    }
  });
