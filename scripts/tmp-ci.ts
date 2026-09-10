const engine = await import("@/lib/trending/trending-engine.server");
const { rows, source } = await engine.getRanking();
console.log("source", source, "rows", rows.length);
console.log(JSON.stringify(rows.slice(0,5).map(r=>[r.address,r.creator]),null,2));
