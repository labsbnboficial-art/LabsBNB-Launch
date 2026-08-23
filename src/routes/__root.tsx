import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider } from "@/lib/i18n";
import { Web3Provider } from "@/lib/web3/provider";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { AiCopilot } from "@/components/labsbnb/AiCopilot";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center hero-bg px-4">
      <div className="max-w-md text-center glass rounded-3xl p-10">
        <h1 className="text-7xl font-bold text-gradient font-display">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl brand-gradient px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary transition-transform hover:scale-[1.02]"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center hero-bg px-4">
      <div className="max-w-md text-center glass rounded-3xl p-10">
        <h1 className="text-xl font-semibold tracking-tight">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-xl brand-gradient px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary"
          >
            Try again
          </button>
          <a href="/" className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LabsBNB Launchpad — Launch tokens on BNB Chain" },
      { name: "description", content: "Create, launch and trade tokens with virtual bonding curves. Zero deploy fees. Part of the LabsBNB ecosystem." },
      { name: "author", content: "LabsBNB" },
      { property: "og:title", content: "LabsBNB Launchpad — Launch tokens on BNB Chain" },
      { property: "og:description", content: "Create, launch and trade tokens with virtual bonding curves. Zero deploy fees. Part of the LabsBNB ecosystem." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#0b1024" },
      { name: "twitter:title", content: "LabsBNB Launchpad — Launch tokens on BNB Chain" },
      { name: "twitter:description", content: "Create, launch and trade tokens with virtual bonding curves. Zero deploy fees. Part of the LabsBNB ecosystem." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/b4edd563-58c6-4070-9954-5ce4b88a85c7" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/b4edd563-58c6-4070-9954-5ce4b88a85c7" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Public RPC endpoints resolved on the server and made available to the
  // browser bundle before it evaluates (see src/lib/web3/runtime-rpc.ts).
  const rpcConfig = collectRuntimeRpcConfig();
  return (
    <html lang="en" className="dark">
      <head>
        <script
          id="labsbnb-runtime-rpc"
          dangerouslySetInnerHTML={{ __html: runtimeRpcScript(rpcConfig) }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Web3Provider>
        <AuthProvider>
          <I18nProvider>
            <Outlet />
            <AiCopilot />
            <Toaster position="top-right" richColors closeButton />
          </I18nProvider>
        </AuthProvider>
      </Web3Provider>
    </QueryClientProvider>
  );
}
