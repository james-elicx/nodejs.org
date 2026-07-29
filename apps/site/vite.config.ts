import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { cloudflare } from '@cloudflare/vite-plugin';
import { cdnAdapter } from '@vinext/cloudflare/cache/cdn-adapter';
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer';
import vinext from 'vinext';
import { defineConfig } from 'vite';

import type { Plugin, ViteDevServer } from 'vite';

const fsAssetsManifest = 'virtual:nodejs-org-cloudflare-fs-assets';
const resolvedFsAssetsManifest = `\0${fsAssetsManifest}`;
const fsPromisesPolyfill = resolve(
  import.meta.dirname,
  'cloudflare/fs-promises.mjs'
);
const createVfsTwoslasher = resolve(
  import.meta.dirname,
  'mdx/create-vfs-twoslasher.mjs'
);
const downloadSnippets = resolve(
  import.meta.dirname,
  'next-data/generators/downloadSnippets.mjs'
);
const dynamicRouter = resolve(import.meta.dirname, 'next.dynamic.mjs');
const nextHelpers = resolve(import.meta.dirname, 'next.helpers.mjs');
const fsAssetsRoot = resolve(import.meta.dirname, 'dist/client');
const fsAssetSources = ['pages', 'snippets'];

const getFsAssetFiles = async () => {
  const files: Array<string> = [];

  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
      entries.map(async entry => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
          await visit(path);
        } else if (entry.isFile()) {
          files.push(
            relative(import.meta.dirname, path)
              .split(sep)
              .join('/')
          );
        }
      })
    );
  };

  await Promise.all(
    fsAssetSources.map(source => visit(resolve(import.meta.dirname, source)))
  );

  return files.sort();
};

const fsAssetFiles = getFsAssetFiles();

const cloudflareFsAssets = (): Plugin => ({
  name: 'nodejs-org:cloudflare-fs-assets',
  enforce: 'pre' as const,
  resolveId(id) {
    if (id === fsAssetsManifest) {
      return resolvedFsAssetsManifest;
    }
  },
  async load(id) {
    if (id === resolvedFsAssetsManifest) {
      return `export default ${JSON.stringify(await fsAssetFiles)};`;
    }
  },
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
        !pathname.startsWith('/_fs_/pages/') &&
        !pathname.startsWith('/_fs_/snippets/')
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
    if (id === dynamicRouter) {
      return code.replace('node:fs/promises', fsPromisesPolyfill).replace(
        "join(process.cwd(), 'pages')",
        // The generated Worker filesystem indexes these assets from its
        // root rather than from the build machine's absolute working path.
        "'pages'"
      );
    }

    if (id === nextHelpers || id === downloadSnippets) {
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
