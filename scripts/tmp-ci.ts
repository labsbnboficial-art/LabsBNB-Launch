const e = await import("@/lib/trending/trending-engine.server");
const r = await e.runTrendingEngine("audit");
console.log(JSON.stringify({rows:r.rows.length, state:(r as any).state}, null, 2).slice(0,3000));
