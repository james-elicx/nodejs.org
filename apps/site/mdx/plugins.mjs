'use strict';

import rehypeShikiji from '@node-core/rehype-shiki/plugin';
import remarkHeadings from '@vcarl/remark-headings';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import readingTime from 'remark-reading-time';

import remarkTableTitles from '../util/table';

// TODO(@avivkeller): When available, use `OPEN_NEXT_CLOUDFLARE` environment
// variable for detection instead of current method, which will enable better
// tree-shaking.
// Reference: https://github.com/nodejs/nodejs.org/pull/7896#issuecomment-3009480615
const OPEN_NEXT_CLOUDFLARE = 'Cloudflare' in global;

// When running inside the Vite RSC worker (vinext dev) or a Cloudflare Worker,
// the process object is a shim provided by unenv whose cwd() returns a synthetic
// path like "/" or "/bundle" — never a real on-disk project path. Real Node.js
// always returns an absolute path rooted in the actual filesystem.
//
// WebAssembly.instantiate() is blocked at the embedder level in both of these
// environments, and the crash it produces ("Aborted: Wasm code generation
// disallowed by embedder") comes from deep inside the emscripten runtime baked
// into the WASM binary — it cannot be caught with try/catch. We must avoid
// calling createOnigurumaEngine entirely in these environments.
//
// Checking process.cwd() is the most reliable runtime signal: unenv hard-codes
// it to "/" by default (chdir'd to "/bundle" by the @cloudflare/vite-plugin
// runner), so any cwd that is "/" or "/bundle" means we are in a sandboxed
// worker where WASM must be disabled.
const cwd = process.cwd();
console.log('[plugins.mjs] process.cwd():', cwd);
console.log('[plugins.mjs] import.meta.url:', import.meta.url);
console.log('[plugins.mjs] typeof WebAssembly:', typeof WebAssembly);
console.log(
  '[plugins.mjs] typeof WebAssembly.instantiate:',
  typeof WebAssembly?.instantiate
);
const REAL_NODE = cwd !== '/' && cwd !== '/bundle';
console.log(
  '[plugins.mjs] REAL_NODE:',
  REAL_NODE,
  '— USE_WASM will be:',
  !OPEN_NEXT_CLOUDFLARE && REAL_NODE
);

const USE_WASM = !OPEN_NEXT_CLOUDFLARE && REAL_NODE;

// Twoslash requires loading the TypeScript compiler and performing type-checks
// at syntax-highlight time.  In a production build the twoslash chunk
// (index-B7jGOecK.js) re-imports the main worker-entry bundle, which creates a
// circular top-level-await dependency that deadlocks Node.js ESM loader.
// Twoslash is only useful during `vinext dev` (where Vite's module runner
// evaluates chunks lazily and avoids the cycle), so we gate it on the Vite
// dev-server signal: import.meta.hot is defined only in that context.
//
// Summary of USE_* flags:
//   Cloudflare Worker  → USE_WASM=false, USE_TWOSLASH=false
//   vinext dev (Node)  → USE_WASM=true,  USE_TWOSLASH=true
//   vinext start (Node)→ USE_WASM=true,  USE_TWOSLASH=false
const USE_TWOSLASH = USE_WASM && typeof import.meta.hot !== 'undefined';

// Shiki is created out here to avoid an async rehype plugin
const singletonShiki = await rehypeShikiji({
  // We use the faster WASM engine on the server instead of the web-optimized version.
  //
  // Currently we fall back to the JavaScript RegEx engine on runtimes where
  // `shiki/wasm` requires loading via `WebAssembly.instantiate` with custom
  // imports that the embedder disallows (Cloudflare Workers, Vite RSC worker).
  wasm: USE_WASM,

  // TODO(@avivkeller): Find a way to enable Twoslash w/ a VFS on Cloudflare
  // Disabled in production builds to prevent a circular TLA deadlock: the
  // twoslash chunk re-imports the parent worker-entry module, which Node.js
  // ESM cannot resolve while the parent's own top-level await is still pending.
  twoslash: USE_TWOSLASH,
});

/**
 * Provides all our Rehype Plugins that are used within MDX
 */
export const rehypePlugins = [
  // Generates `id` attributes for headings (H1, ...)
  rehypeSlug,
  // Automatically add anchor links to headings (H1, ...)
  [rehypeAutolinkHeadings, { behavior: 'wrap' }],
  // Transforms sequential code elements into code tabs and
  // adds our syntax highlighter (Shikiji) to Codeboxes
  () => singletonShiki,
];

/**
 * Provides all our Remark Plugins that are used within MDX
 */
export const remarkPlugins = [
  // Support GFM syntax to be used within Markdown
  remarkGfm,
  // Generates metadata regarding headings
  remarkHeadings,
  // Calculates the reading time of the content
  readingTime,
  remarkTableTitles,
];
