// Public RPC surface for the Creator System (Fase 2A).
// Read-only: reputation, stats and badges are ALWAYS computed server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CreatorLeaderboardRow, CreatorProfile } from "./creator/creator-types";

const addressSchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

export const leaderboardSchema = z.object({
  sort: z.enum(["score", "graduations", "volume", "trending"]).default("score"),
  limit: z.number().int().min(1).max(100).default(50),
});

export type CreatorProfileResponse = { profile: CreatorProfile | null; source: string };
export type CreatorLeaderboardResponse = {
  creators: CreatorLeaderboardRow[];
  total: number;
  source: string;
};

export const getCreator = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => addressSchema.parse(d))
  .handler(async ({ data }): Promise<CreatorProfileResponse> => {
    const svc = await import("./creator/creator-service.server");
    return svc.getCreatorProfile(data.address);
  });

export const getTopCreators = createServerFn({ method: "GET" })
  .inputValidator((d: { sort?: string; limit?: number } | undefined) => leaderboardSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<CreatorLeaderboardResponse> => {
    const svc = await import("./creator/creator-service.server");
    return svc.getCreatorLeaderboard(data.sort, data.limit);
  });
