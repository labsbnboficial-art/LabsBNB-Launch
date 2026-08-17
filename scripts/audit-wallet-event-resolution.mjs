import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const output = await mkdtemp(join(tmpdir(), "labsbnb-wallet-events-"));

try {
  await build({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: {
        events: new URL("../node_modules/events/events.js", import.meta.url).pathname,
      },
    },
    build: {
      outDir: output,
      emptyOutDir: true,
      lib: {
        entry: new URL("./wallet-event-resolution.entry.mjs", import.meta.url).pathname,
        formats: ["es"],
        fileName: "wallet-event-resolution",
      },
      minify: false,
    },
  });

  const bundle = await readFile(join(output, "wallet-event-resolution.js"), "utf8");
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
  const report = module.auditEventResolution();

  if (!report.eventemitter3Named || !report.nodeEventsNamed) {
    throw new Error(`Invalid browser bundle exports: ${JSON.stringify(report)}`);
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(output, { recursive: true, force: true });
}