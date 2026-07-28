import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { cloudflare } from '@cloudflare/vite-plugin';
import { cdnAdapter } from '@vinext/cloudflare/cache/cdn-adapter';
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer';
import vinext from 'vinext';
import { defineConfig } from 'vite';

import type { ViteDevServer } from 'vite';

const fsPromisesPolyfill = resolve(
  import.meta.dirname,
  '.vinext-fs-assets/polyfills/node/fs/promises.ts'
);
const createVfsTwoslasher = resolve(
  import.meta.dirname,
  'mdx/create-vfs-twoslasher.mjs'
);
const nextHelpers = resolve(import.meta.dirname, 'next.helpers.mjs');
const fsAssetsRoot = resolve(import.meta.dirname, 'dist/client');

const cloudflareFsAssets = () => ({
  name: 'nodejs-org:cloudflare-fs-assets',
  enforce: 'pre' as const,
  configureServer(server: ViteDevServer) {
    // Cloudflare's development ASSETS binding forwards these requests through
    // Vite, so serve them before Vite treats Markdown as a source module.
    server.middlewares.use(async (request, response, next) => {
      if (!request.url) {
        return next();
      }

      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname
      );
      if (
        !pathname.startsWith('/pages/') &&
        !pathname.startsWith('/snippets/')
      ) {
        return next();
      }

      const assetPath = resolve(fsAssetsRoot, `.${pathname}`);
      if (!assetPath.startsWith(`${fsAssetsRoot}/`)) {
        return next();
      }

      try {
        const contents = await readFile(assetPath);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(contents);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return next();
        }

        next(error);
      }
    });
  },
  transform(code: string, id: string) {
    if (id === resolve(import.meta.dirname, 'next.dynamic.mjs')) {
      return code
        .replace('node:fs/promises', fsPromisesPolyfill)
        .replace(
          "join(process.cwd(), 'pages')",
          // The generated Worker filesystem indexes these assets from its
          // root rather than from the build machine's absolute working path.
          "'pages'"
        );
    }

    if (id === nextHelpers) {
      return code.replace('node:fs/promises', fsPromisesPolyfill);
    }

    if (id === createVfsTwoslasher) {
      // workerd rejects dynamic import attributes. Vite still recognizes and
      // bundles this JSON module without the Node-specific attribute.
      return code.replace(", { with: { type: 'json' } }", '');
    }
  },
});

export default defineConfig({
  // TypeScript still reads these CommonJS globals during module
  // initialization. Twoslash uses a virtual filesystem in Workers, so the
  // values only need to identify TypeScript's virtual library directory.
  define: {
    __dirname: JSON.stringify('/typescript/lib'),
    __filename: JSON.stringify('/typescript/lib/typescript.js'),
  },
  optimizeDeps: {
    // vinext's development optimizer otherwise leaves bare imports to these
    // packages' pnpm-isolated transitive dependencies in its SSR output.
    exclude: [
      '@radix-ui/react-accessible-icon',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },
  plugins: [
    cloudflareFsAssets(),
    vinext({
      cache: { cdn: cdnAdapter() },
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
