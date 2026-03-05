import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { transformWithEsbuild, defineConfig } from 'vite';

import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Workspace package src roots — resolved via pnpm workspace symlinks
const uiComponentsSrc = path.resolve(
  __dirname,
  '../../packages/ui-components/src'
);
const rehypeShikiSrc = path.resolve(
  __dirname,
  '../../packages/rehype-shiki/src'
);

/**
 * Given a base src directory and a bare subpath (no leading './'), try each
 * candidate path in order and return the first one that is an existing file.
 * Candidates cover: bare path (CSS/MJS files that already carry an extension),
 * .tsx, .ts, /index.tsx, /index.ts, .mjs, /index.mjs
 */
function resolveFromSrc(srcDir: string, subpath: string): string | null {
  const candidates = [
    path.join(srcDir, subpath),
    path.join(srcDir, subpath + '.tsx'),
    path.join(srcDir, subpath + '.ts'),
    path.join(srcDir, subpath + '.mjs'),
    path.join(srcDir, subpath, 'index.tsx'),
    path.join(srcDir, subpath, 'index.ts'),
    path.join(srcDir, subpath, 'index.mjs'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin: workspace-resolver
//
// Several workspace packages ship package.json `exports` / `imports` fields
// that use arrays of glob patterns — a rolldown/oxc extension that neither
// Node.js nor Vite understand.  This plugin intercepts those imports before
// Vite's default resolver and maps them directly to the source files.
//
// Handled prefixes:
//   @node-core/ui-components/<subpath>  → packages/ui-components/src/<subpath>
//   #ui/<subpath>   (internal to ui-components) → same src root
//   #rs/<subpath>   (internal to rehype-shiki)  → packages/rehype-shiki/src/<subpath>
//   #site/<subpath> (internal to apps/site)     → apps/site/<subpath>
// ---------------------------------------------------------------------------
const workspaceResolverPlugin = {
  name: 'workspace-resolver',
  enforce: 'pre' as const,
  resolveId(id: string, importer: string | undefined) {
    // External subpath imports: @node-core/ui-components/<subpath>
    if (id.startsWith('@node-core/ui-components/')) {
      const subpath = id.slice('@node-core/ui-components/'.length);
      return resolveFromSrc(uiComponentsSrc, subpath);
    }

    // Internal package imports only make sense when the importer is inside
    // the relevant package (Vite passes the importer as an absolute path).
    if (id.startsWith('#ui/') && importer?.includes('ui-components')) {
      const subpath = id.slice('#ui/'.length);
      return resolveFromSrc(uiComponentsSrc, subpath);
    }

    if (id.startsWith('#rs/') && importer?.includes('rehype-shiki')) {
      const subpath = id.slice('#rs/'.length);
      return resolveFromSrc(rehypeShikiSrc, subpath);
    }

    // #site/* — internal imports within apps/site itself.
    // The package.json `imports` field uses arrays of globs (not valid for
    // Node/Vite), so we resolve them here with full extension fallback.
    if (id.startsWith('#site/')) {
      const subpath = id.slice('#site/'.length);
      return resolveFromSrc(__dirname, subpath);
    }

    return null;
  },
};

// ---------------------------------------------------------------------------
// Plugin: request-logger
//
// Wraps every incoming HTTP request and logs:
//   METHOD  /path/to/url  →  STATUS  (Xms)
// Color coding: 2xx green, 3xx cyan, 4xx yellow, 5xx red.
// Errors that bubble out of handlers (unhandled exceptions) are logged in red.
// Only active in dev mode (configureServer is never called during build).
// ---------------------------------------------------------------------------
const requestLoggerPlugin = {
  name: 'request-logger',
  configureServer(server: {
    middlewares: {
      use: (
        fn: (
          req: IncomingMessage,
          res: ServerResponse,
          next: () => void
        ) => void
      ) => void;
    };
  }) {
    // Install as the very first middleware so every request is captured,
    // including ones that are handled by @vitejs/plugin-rsc or vinext before
    // reaching Vite's own static-file / error middleware.
    server.middlewares.use(
      (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url =
          (req as IncomingMessage & { originalUrl?: string }).originalUrl ??
          req.url ??
          '/';

        // Skip Vite internals — they're noise and fire on every HMR ping.
        if (
          url.startsWith('/@') ||
          url.startsWith('/__vite') ||
          url.startsWith('/node_modules') ||
          url === '/favicon.ico'
        ) {
          return next();
        }

        const method = (req.method ?? 'GET').toUpperCase();
        const start = Date.now();

        // Intercept writeHead so we capture the status code that the downstream
        // handler actually sends, even when it never calls res.end() explicitly
        // (e.g. streaming responses from @vitejs/plugin-rsc).
        const resAny = res as ServerResponse & {
          _loggedStatus?: number;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          writeHead: (...args: Array<any>) => any;
        };
        const origWriteHead = resAny.writeHead.bind(resAny);
        resAny.writeHead = function (
          statusCode: number,
          ...args: Array<unknown>
        ) {
          resAny._loggedStatus = statusCode;
          return origWriteHead(statusCode, ...args);
        };

        res.on('finish', () => {
          const status =
            (res as ServerResponse & { _loggedStatus?: number })
              ._loggedStatus ?? res.statusCode;
          const ms = Date.now() - start;

          // ANSI colour helpers (no extra dep needed)
          const reset = '\x1b[0m';
          const bold = '\x1b[1m';
          const dim = '\x1b[2m';
          const green = '\x1b[32m';
          const cyan = '\x1b[36m';
          const yellow = '\x1b[33m';
          const red = '\x1b[31m';
          const blue = '\x1b[34m';

          const statusColour =
            status >= 500
              ? red
              : status >= 400
                ? yellow
                : status >= 300
                  ? cyan
                  : green;

          const methodColour =
            method === 'GET'
              ? blue
              : method === 'POST'
                ? green
                : method === 'PUT'
                  ? yellow
                  : method === 'DELETE'
                    ? red
                    : dim;

          console.log(
            `${bold}${methodColour}${method.padEnd(7)}${reset}` +
              `${dim}${url}${reset}` +
              `  →  ` +
              `${bold}${statusColour}${status}${reset}` +
              `  ${dim}(${ms}ms)${reset}`
          );
        });

        next();
      }
    );
  },
};

// ---------------------------------------------------------------------------
// Plugin: mjs-jsx
// Vite's esbuild transformer only processes JSX in .jsx/.tsx files by default.
// This project has next.dynamic.page.mjs which contains JSX but uses the .mjs
// extension, so we pre-transform those files with esbuild's jsx loader.
// ---------------------------------------------------------------------------
const mjsJsxPlugin = {
  name: 'mjs-jsx',
  enforce: 'pre' as const,
  async transform(code: string, id: string) {
    if (id.endsWith('.mjs') && (code.includes('</') || code.includes('/>'))) {
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic',
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------
export default defineConfig({
  plugins: [
    requestLoggerPlugin,
    workspaceResolverPlugin,
    mjsJsxPlugin,
    vinext(),
    // cloudflare({
    //   viteEnvironment: {
    //     name: 'rsc',
    //     childEnvironments: ['ssr'],
    //   },
    // }),
  ],
  resolve: {
    alias: {
      // @/ path alias matching tsconfig paths
      // "@": path.resolve(__dirname, "src"),
      //
      // next-intl requires this alias to locate the i18n/request.ts config file.
      // In a standard Next.js setup, createNextIntlPlugin() from next.config.ts
      // injects this webpack/turbopack alias automatically. Here we replicate it
      // explicitly since vinext uses Vite instead of the Next.js build pipeline.
      // "next-intl/config": path.resolve(__dirname, "src/i18n/request.ts"),
      // next-intl's Turbopack/webpack plugin registers `next-intl/config` as
      // an alias to the project's i18n request-config file (i18n.tsx).
      // Vinext doesn't read Turbopack resolveAlias from next.config, so we
      // wire up the same alias here so that next-intl's server internals
      // (getRequestConfig, NextIntlClientProvider, etc.) can find it.
      //
      // Note: Vite always propagates top-level resolve.alias into every
      // environment (rsc, ssr, client) — it is not a per-environment option.
      // See resolveEnvironmentResolveOptions in Vite internals:
      //   resolvedResolve.alias = alias$2  (always from resolvedDefaultResolve)
      'next-intl/config': path.resolve(__dirname, './i18n.tsx'),
    },
  },

  // next-intl and use-intl ship separate react-server / react-client builds
  // selected via export conditions. Vite's dep optimiser runs in Node and
  // picks up the `development` condition for use-intl, which imports
  // createContext from React — invalid in the RSC environment.
  // Excluding them from pre-bundling lets each environment resolve them with
  // the correct export condition at runtime:
  //   rsc → react-server (setRequestLocale, getMessages, etc.)
  //   ssr → react-server (same — layout.tsx runs server-side for HTML)
  //   client → react-client (useTranslations, NextIntlClientProvider, etc.)
  //
  // Critically, the client environment must also exclude them. When
  // @vitejs/plugin-rsc serialises a "use client" node_module into the RSC
  // stream it uses a virtual:vite-rsc/client-in-server-package-proxy URL
  // whose load hook re-exports from the *raw* (non-optimised) file path.
  // If the client dep-optimiser pre-bundles next-intl / use-intl into a
  // separate chunk, components like WithNavBar that import useTranslations
  // directly get the optimised copy while NextIntlClientProvider is loaded
  // from the raw copy. The two copies call createContext() independently,
  // producing different context objects — so useTranslations() finds no
  // provider and throws "context from NextIntlClientProvider was not found".
  environments: {
    client: {
      optimizeDeps: {
        exclude: ['next-intl', 'use-intl'],
      },
    },
    rsc: {
      optimizeDeps: {
        exclude: ['next-intl', 'use-intl'],
      },
    },
    ssr: {
      optimizeDeps: {
        exclude: ['next-intl', 'use-intl'],
      },
    },
  },
});
