// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";

const browserEventsEntry = fileURLToPath(
  new URL("./node_modules/events/events.js", import.meta.url),
);

const resolveBrowserEvents = {
  name: "labsbnb-resolve-browser-events",
  enforce: "pre" as const,
  resolveId(source: string) {
    if (source === "events" || source === "node:events") return browserEventsEntry;
    return null;
  },
};

export default defineConfig({
  vite: {
    plugins: [resolveBrowserEvents],
    resolve: {
      // WalletConnect imports the browser-compatible npm package as `events`.
      // Vite 8 otherwise mistakes that bare specifier for the Node builtin and
      // emits an empty browser shim, leaving `new events.EventEmitter()` broken.
      alias: {
        events: browserEventsEntry,
        "node:events": browserEventsEntry,
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
