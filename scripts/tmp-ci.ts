import { readClient } from "@/lib/web3/onchain-token";
import { FACTORY_ABI } from "@/lib/web3/abis";
import { DEFAULT_CONFIG } from "@/lib/launchpad-config";
const f = DEFAULT_CONFIG.factory_address as `0x${string}`;
console.log("factory", f, "chain", (readClient() as any).chain?.id);
const names = (FACTORY_ABI as any[]).filter(x=>x.type==="function").map(x=>x.name);
console.log("fns", names.join(","));
for (const fn of ["allTokensLength","tokensCount","totalTokens","getTokensCount"]) {
  if (!names.includes(fn)) continue;
  try { console.log(fn, await readClient().readContract({address:f,abi:FACTORY_ABI as any,functionName:fn})); } catch(e){ console.log(fn,"ERR",(e as Error).message.slice(0,120)); }
}
