// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// eventemitter3's CJS entry only assigns `module.exports` when a CJS `module`
// global exists, leaving an empty namespace in some browser bundles and crashing
// wallet connectors with "X.EventEmitter is not a constructor". The shipped ESM
// build is self-contained, so point every importer at it. The subpath is not
// declared in the package's "exports" map, so resolve it as an absolute path.
const eventemitter3Esm = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "node_modules/eventemitter3/dist/eventemitter3.esm.js",
);

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        eventemitter3: eventemitter3Esm,
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        alias: { eventemitter3: eventemitter3Esm },
      },
    },
  },

  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
