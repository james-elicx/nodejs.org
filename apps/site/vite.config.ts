import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflare } from '@cloudflare/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';
import vinext from 'vinext';
import { transformWithEsbuild, defineConfig } from 'vite';

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
  // The dependency pre-bundling scan phase uses a top-level esbuild invocation
  // that is separate from each environment's optimizeDeps.esbuildOptions.
  // Without this, esbuild encounters .mjs files containing JSX (e.g.
  // mdx/compiler.mjs and next.dynamic.page.mjs) and errors with
  // "The JSX syntax extension is not currently enabled".
  optimizeDeps: {
    esbuildOptions: { loader: { '.mjs': 'jsx' } },
  },
  plugins: [
    workspaceResolverPlugin,
    mjsJsxPlugin,
    vinext(),

    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,

    // Bundle analysis — only active when the ANALYZE env var is set.
    //
    // Usage (target the worker/SSR entry):
    //   ANALYZE=ssr pnpm build:vinext
    //
    // Other valid values: rsc, client
    //   ANALYZE=rsc pnpm build:vinext
    //   ANALYZE=client pnpm build:vinext
    //
    // The report is written to dist/stats.<env>.html and opened automatically
    // in your default browser once the build finishes.
    //
    // rollup-plugin-visualizer works by hooking into Rollup/Rolldown's
    // generateBundle phase. In a multi-environment Vite build each environment
    // runs its own Rolldown pipeline, so the plugin will see whichever
    // environment(s) emit chunks. Setting ANALYZE to the environment name you
    // care about keeps the filename unambiguous.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            // Place the report in dist/ at the root of the app so it is easy
            // to find regardless of which sub-directory the env writes to.
            filename: `dist/stats.${process.env.ANALYZE}.html`,
            // Treemap gives the most useful at-a-glance breakdown of what is
            // taking up space inside the bundle.
            template: 'treemap',
            // Open the finished report in the browser automatically.
            open: true,
            // Show gzip-compressed sizes alongside raw sizes — gives a more
            // realistic idea of over-the-wire cost.
            gzipSize: true,
            // Show brotli-compressed sizes too; Cloudflare serves brotli by
            // default so this is the most relevant metric for Workers bundles.
            brotliSize: true,
            // Title shown at the top of the HTML report.
            title: `Bundle analysis — ${process.env.ANALYZE} environment`,
          }),
        ]
      : []),
  ],

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
        esbuildOptions: { loader: { '.mjs': 'jsx' } },
      },
    },
    rsc: {
      optimizeDeps: {
        // next/og and @vercel/og embed an emscripten WASM binary that calls
        // WebAssembly.instantiate() at module load time. The Vite RSC worker
        // environment (via @cloudflare/vite-plugin) blocks WASM code generation
        // at the embedder level, causing an unrecoverable crash. Excluding
        // these packages from pre-bundling prevents them from being inlined
        // into the RSC worker bundle — they remain as externals that are never
        // actually executed in this environment (OG image routes only run at
        // request time on a real Node.js server).
        exclude: ['next-intl', 'use-intl'],
        esbuildOptions: { loader: { '.mjs': 'jsx' } },
      },
    },
    ssr: {
      optimizeDeps: {
        // @radix-ui/* packages have deep transitive deps that the SSR
        // pre-bundler inlines into a shared chunk but then fails to resolve at
        // runtime inside the miniflare worker. Excluding the full transitive
        // closure lets the worker runner resolve each package directly from
        // node_modules without going through a broken pre-bundled chunk.
        // List derived from: all @radix-ui deps of ui-components + their deps.
        exclude: ['next-intl', 'use-intl'],
        esbuildOptions: { loader: { '.mjs': 'jsx' } },
      },
    },
  },
});
