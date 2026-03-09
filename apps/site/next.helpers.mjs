'use strict';

import { fileURLToPath } from 'node:url';

/**
 * We create a locale cache of Glob Promises
 * to avoid reading the file system multiple times
 * this is done since we don't need to constantly re-run the glob
 * query as it is only needed once
 *
 * @type {Map<string, Promise<Array<string>>>} */
const globCacheByPath = new Map();

/**
 * This gets the relative path from `import.meta.url`
 *
 * @param {string} path the current import path
 * @returns {string} the relative path from import
 */
export const getRelativePath = path => fileURLToPath(new URL('.', path));

// Lazily import all markdown files under pages/ via Vite's import.meta.glob.
//
// Using { eager: false } (the default) means Vite emits each file as a
// separate async chunk instead of inlining every file as a string literal
// inside the Worker bundle. With 1,000+ markdown/MDX files this was
// responsible for ~17 MB of raw content being bundled directly into
// worker-entry, ballooning cold-start parse time on Cloudflare Workers.
//
// The glob map now contains { [path]: () => Promise<{ default: string }> }
// — i.e. a thunk per file that is only evaluated when that specific page is
// actually requested. Cloudflare will serve the emitted chunks from the
// ASSETS binding, so there is no node:fs dependency at runtime.
//
// Glob keys are relative to this file, e.g.:
//   "./pages/en/index.mdx"
//   "./pages/en/learn/getting-started/introduction-to-nodejs.md"
/** @type {Record<string, () => Promise<{ default: string }>>} */
const allMarkdownModules = import.meta.glob('./pages/**/*.{md,mdx}', {
  eager: false,
  query: '?raw',
});

/**
 * Derives the locale and relative filename from a glob key.
 *
 * Glob keys look like "./pages/en/learn/getting-started/intro.md".
 * We strip the leading "./pages/" prefix, then split off the locale
 * (first path segment) from the rest.
 *
 * @param {string} key — a key from the import.meta.glob map
 * @returns {{ locale: string; file: string }} — e.g. { locale: 'en', file: 'learn/getting-started/intro.md' }
 */
function parseGlobKey(key) {
  // key is always "./pages/<locale>/...rest"
  const withoutPrefix = key.replace(/^\.\/pages\//, '');
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex === -1) {
    // Shouldn't happen, but guard against bare locale-only keys
    return { locale: withoutPrefix, file: '' };
  }
  return {
    locale: withoutPrefix.slice(0, slashIndex),
    file: withoutPrefix.slice(slashIndex + 1),
  };
}

/**
 * Build a map of locale → [relative file paths] from the glob result.
 * Computed once and reused across calls.
 *
 * @type {Record<string, Array<string>>}
 */
const filesByLocale = (() => {
  /** @type {Record<string, Array<string>>} */
  const map = {};
  for (const key of Object.keys(allMarkdownModules)) {
    const { locale, file } = parseGlobKey(key);
    if (!file) continue;
    (map[locale] ??= []).push(file);
  }
  return map;
})();

/**
 * Map of "locale/relative-file" → async loader thunk.
 *
 * Previously this map held the fully-resolved raw string for every markdown
 * file, which meant all ~1,000 files were inlined into the Worker bundle at
 * build time (~17 MB of raw content). Now each entry is a zero-argument
 * async function that dynamically imports the file only when it is needed.
 *
 * Callers that previously did a synchronous lookup:
 *   markdownContentsByLocaleAndFile[key]  →  string | undefined
 *
 * must now await the loader:
 *   await getMarkdownContent(locale, file)  →  string | undefined
 *
 * Use the exported `getMarkdownContent` helper below rather than accessing
 * this map directly.
 *
 * @type {Record<string, () => Promise<{ default: string }>>}
 */
export const markdownContentsByLocaleAndFile = (() => {
  /** @type {Record<string, () => Promise<{ default: string }>>} */
  const map = {};
  for (const [key, loader] of Object.entries(allMarkdownModules)) {
    const { locale, file } = parseGlobKey(key);
    if (!file) continue;
    map[`${locale}/${file}`] = loader;
  }
  return map;
})();

/**
 * Resolves the raw markdown source for a given locale + file path.
 *
 * Lazily invokes the Vite-generated dynamic import thunk so that only the
 * requested file is fetched — no other content is loaded into memory.
 *
 * @param {string} locale — e.g. "en"
 * @param {string} file   — relative path within the locale dir, e.g. "blog/release/v20.md"
 * @returns {Promise<string | undefined>}
 */
export async function getMarkdownContent(locale, file) {
  const loader = markdownContentsByLocaleAndFile[`${locale}/${file}`];
  if (!loader) return undefined;
  const mod = await loader();
  const source = /** @type {any} */ (mod).default ?? mod;
  return typeof source === 'string' ? source : undefined;
}

/**
 * This method is responsible for retrieving a glob of all files that exist
 * within a given language directory.
 *
 * Uses the keys from the lazy import.meta.glob map (populated at Vite
 * build/dev startup) instead of runtime filesystem calls, so it works
 * correctly in every environment including the Vite RSC worker where node:fs
 * is shimmed by unenv. Only the file list (keys) is consulted here — the
 * actual file contents are NOT loaded until a specific page is requested.
 *
 * Note that we ignore the blog directory for static builds as otherwise
 * generating that many pages would be too much for the build process to handle.
 *
 * @param {string} root the root directory to search from (unused — kept for API compatibility)
 * @param {string} cwd the given locale path (relative to root, e.g. "pages/en")
 * @param {Array<string>} exclude an array of glob patterns to ignore
 * @returns {Promise<Array<string>>} a promise containing an array of relative paths
 */
export const getMarkdownFiles = async (root, cwd, exclude = []) => {
  const cacheKey = `${root}${cwd}${exclude.join('')}`;

  if (!globCacheByPath.has(cacheKey)) {
    // cwd is a relative path like "pages/en" — extract just the locale segment
    const cwdNorm = cwd.replace(/\\/g, '/');
    const pagesPrefix = 'pages/';
    const locale = cwdNorm.startsWith(pagesPrefix)
      ? cwdNorm.slice(pagesPrefix.length)
      : cwdNorm;

    const files = filesByLocale[locale] ?? [];

    const filtered =
      exclude.length === 0
        ? files
        : files.filter(f => !exclude.some(pat => f.includes(pat)));

    globCacheByPath.set(cacheKey, Promise.resolve(filtered));
  }

  return globCacheByPath.get(cacheKey);
};
