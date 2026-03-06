import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { transformWithEsbuild, defineConfig } from 'vite';

import type { Plugin } from 'vite';

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
// Plugin: node-wasm-patch
//
// The @cloudflare/vite-plugin bundles `.wasm` files into the RSC worker entry
// using Cloudflare's native WASM module import syntax:
//
//   import resvg_wasm from "./resvg-Cjh1zH0p.wasm";
//   import "./resvg-Cjh1zH0p.wasm";   ← side-effect form in dist/server/index.js
//
// Named imports (.wasm → WebAssembly.Module default export) are now handled
// transparently by the vinext wasm-hook.js ESM loader hook registered in
// prod-server.js, so dist/server/ needs no patching for those.
//
// Two remaining Node.js incompatibilities are fixed here post-build:
//
// 1. Side-effect .wasm imports in dist/server/index.js
//    Node.js (even with the hook) will attempt to evaluate the side-effect
//    import before the hook can short-circuit it cleanly.  We simply strip
//    these bare imports — the actual WebAssembly.Module is already obtained
//    via the named import in the worker-entry chunk.
//
// 2. @vercel/og top-level font fetch using import.meta.url
//    The worker-entry contains:
//      var fallbackFont = fetch(new URL("./noto-sans-...ttf", import.meta.url))
//    Node.js fetch() cannot handle file:// URLs. We replace this with a
//    readFileSync-based equivalent that works in both environments.
//
// dist/server/ is patched in-place. wrangler dev is unaffected because it
// runs the worker inside miniflare where native WASM imports are valid and
// import.meta.url is not used for font loading (CF rewrites that at bundle
// time). The patches here are no-ops from CF's perspective.
//
// The hook is `enforce: 'post'` and only fires during build (not dev).
// ---------------------------------------------------------------------------
// Matches:  import "./something.wasm";   (side-effect only, no binding)
const WASM_SIDE_EFFECT_IMPORT_RE = /^import\s+["']([^"']+\.wasm)["'];?$/gm;

// Matches any new URL("./something.ttf", import.meta.url) expression.
//
// In Cloudflare Workers import.meta.url is undefined, so
// `new URL(ttf, undefined)` throws "Invalid URL string" at startup.
// Wrangler normally rewrites these at bundle/deploy time, but wrangler dev
// runs the already-built files directly and hits the crash.
//
// Fix: replace `import.meta.url` with `import.meta.url ?? "file:///"`
// so the URL constructor doesn't throw in CF Workers. The fallback URL is
// never actually fetched there. In Node.js, import.meta.url is always
// defined so the fallback is never used.
//
// We also scan for all .ttf filenames referenced this way and copy them
// from node_modules into the dist/server/assets/ directory so that the
// Node.js file:// fetch polyfill in prod-server can read them.
const FONT_META_URL_RE =
  /new URL\(["'](\.[^"']+\.ttf)["'],\s*import\.meta\.url\s*\)/g;

/**
 * Walk a directory recursively and yield absolute paths of every .js file.
 */
function* walkJs(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJs(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

const nodeWasmPatchPlugin: Plugin = {
  name: 'node-wasm-patch',
  enforce: 'post',
  apply: 'build',
  applyToEnvironment(env) {
    // Only post-process the RSC (server) build output.
    // The Cloudflare plugin owns the rsc environment build; we run after it.
    return env.name === 'rsc';
  },
  closeBundle() {
    const outDir = path.resolve(__dirname, 'dist', 'server');
    if (!fs.existsSync(outDir)) {
      return;
    }

    let patchCount = 0;

    for (const filePath of walkJs(outDir)) {
      let code = fs.readFileSync(filePath, 'utf-8');
      let changed = false;

      // --- font file:// URLs: guard import.meta.url + copy missing fonts ---
      // CF Workers have import.meta.url === undefined, so
      // new URL("./font.ttf", import.meta.url) throws at startup.
      // Guard with a null-safe fallback and ensure the .ttf files exist
      // next to the chunk so the Node.js file:// fetch polyfill can read them.
      if (FONT_META_URL_RE.test(code)) {
        FONT_META_URL_RE.lastIndex = 0;

        // Collect every .ttf specifier referenced in this file.
        const ttfSpecifiers: Array<string> = [];
        let m: RegExpExecArray | null;
        while ((m = FONT_META_URL_RE.exec(code)) !== null) {
          ttfSpecifiers.push(m[1]); // e.g. "./noto-sans-v27-latin-regular.ttf"
        }
        FONT_META_URL_RE.lastIndex = 0;

        // Copy any missing font files next to this JS chunk.
        // Search for each font by basename across all node_modules under the
        // project root — this handles pnpm, nested deps, etc.
        const jsDir = path.dirname(filePath);
        for (const specifier of ttfSpecifiers) {
          const basename = path.basename(specifier);
          const dest = path.join(jsDir, basename);
          if (fs.existsSync(dest)) {continue;}

          // Walk node_modules looking for the font file.
          const found = (function findFont(
            dir: string,
            depth = 0
          ): string | null {
            if (depth > 6) {return null;}
            const nmDir = path.join(dir, 'node_modules');
            if (!fs.existsSync(nmDir)) {return null;}
            // Breadth-first: check all packages at this level first.
            for (const pkg of fs.readdirSync(nmDir)) {
              const pkgDir = path.join(nmDir, pkg.startsWith('@') ? pkg : pkg);
              // For scoped packages, descend one more level.
              if (pkg.startsWith('@')) {
                try {
                  for (const sub of fs.readdirSync(pkgDir)) {
                    const candidate = path.join(pkgDir, sub, 'dist', basename);
                    if (fs.existsSync(candidate)) {return candidate;}
                    const candidate2 = path.join(pkgDir, sub, basename);
                    if (fs.existsSync(candidate2)) {return candidate2;}
                  }
                } catch {
                  /* not a dir */
                }
                continue;
              }
              const candidate = path.join(pkgDir, 'dist', basename);
              if (fs.existsSync(candidate)) {return candidate;}
              const candidate2 = path.join(pkgDir, basename);
              if (fs.existsSync(candidate2)) {return candidate2;}
            }
            // Recurse into nested node_modules.
            for (const pkg of fs.readdirSync(nmDir)) {
              const result = findFont(path.join(nmDir, pkg), depth + 1);
              if (result) {return result;}
            }
            return null;
          })(__dirname);

          if (found) {
            fs.copyFileSync(found, dest);
            console.log(
              `[node-wasm-patch] Copied font ${basename} → ${path.relative(outDir, dest)}`
            );
          } else {
            console.warn(
              `[node-wasm-patch] Could not find font ${basename} in node_modules`
            );
          }
        }

        // Patch import.meta.url → import.meta.url ?? "file:///" so CF Workers
        // don't crash when evaluating new URL(ttf, undefined) at startup.
        const patched = code.replace(FONT_META_URL_RE, match =>
          match.replace('import.meta.url', 'import.meta.url ?? "file:///"')
        );
        if (patched !== code) {
          code = patched;
          changed = true;
        }
      }

      // --- side-effect WASM imports: import "./x.wasm"; ---
      // These appear in the RSC index.js as re-exports of assets pulled in by
      // the worker entry. They have no binding so there is nothing to compile;
      // the actual WASM compilation happens in the worker-entry chunk that
      // holds the named import. We simply remove the bare import so Node.js
      // does not try to parse the binary as an ES module.
      if (WASM_SIDE_EFFECT_IMPORT_RE.test(code)) {
        WASM_SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
        const patched = code.replace(
          WASM_SIDE_EFFECT_IMPORT_RE,
          (_match, specifier: string) => {
            return `// [node-wasm-patch] removed side-effect WASM import: ${specifier}`;
          }
        );
        if (patched !== code) {
          code = patched;
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, code, 'utf-8');
        console.log(
          `[node-wasm-patch] Patched in ${path.relative(outDir, filePath)}`
        );
        patchCount++;
      }
    }

    if (patchCount > 0) {
      console.log(
        `[node-wasm-patch] Patched ${patchCount} file(s) in ${outDir}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------
export default defineConfig({
  plugins: [
    workspaceResolverPlugin,
    mjsJsxPlugin,
    nodeWasmPatchPlugin,
    vinext(),

    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
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
        exclude: ['next-intl', 'use-intl', 'next/og', '@vercel/og'],
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
        exclude: [
          'next-intl',
          'use-intl',
          'next/og',
          '@vercel/og',
          '@radix-ui/primitive',
          '@radix-ui/react-avatar',
          '@radix-ui/react-compose-refs',
          '@radix-ui/react-context',
          '@radix-ui/react-dialog',
          '@radix-ui/react-direction',
          '@radix-ui/react-dismissable-layer',
          '@radix-ui/react-dropdown-menu',
          '@radix-ui/react-id',
          '@radix-ui/react-label',
          '@radix-ui/react-popper',
          '@radix-ui/react-portal',
          '@radix-ui/react-presence',
          '@radix-ui/react-primitive',
          '@radix-ui/react-roving-focus',
          '@radix-ui/react-select',
          '@radix-ui/react-separator',
          '@radix-ui/react-slot',
          '@radix-ui/react-tabs',
          '@radix-ui/react-tooltip',
          '@radix-ui/react-use-controllable-state',
          '@radix-ui/react-visually-hidden',
        ],
        esbuildOptions: { loader: { '.mjs': 'jsx' } },
      },
    },
  },
});
