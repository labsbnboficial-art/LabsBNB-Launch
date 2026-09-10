import { DEFAULT_CONFIG } from "@/lib/launchpad-config";
import { fetchFactoryTokens } from "@/lib/web3/onchain-token";
console.log("factory", DEFAULT_CONFIG.factory_address);
try { const t = await fetchFactoryTokens(10); console.log("tokens", t.length, t.map(x=>x.address)); }
catch(e){ console.log("ERR", (e as Error).message.slice(0,300)); }
