import { getCreatorIndex } from "@/lib/creator/creator-service.server";
const idx = await getCreatorIndex();
console.log("profiles", idx.profiles.length, Object.keys(idx));
console.log(JSON.stringify(idx.profiles.map(p=>[p.address,p.score,p.stats.graduatedTokens]),null,2));
