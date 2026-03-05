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

// Eagerly import all markdown files under pages/ at build time via Vite's
// import.meta.glob. This runs in real Node.js land during the Vite transform
// step, so the file contents are inlined into the module graph — no virtual
// module plugin, no runtime readFile, no node:fs required.
//
// The glob key is a path relative to this file, e.g.:
//   "./pages/en/index.mdx"
//   "./pages/en/learn/getting-started/introduction-to-nodejs.md"
//
// { eager: true, query: '?raw' } inlines each file as a plain string, the
// same way ?raw imports work in Vite (no MDX compilation here — that happens
// later in the compiler pipeline).
const allMarkdownModules = import.meta.glob('./pages/**/*.{md,mdx}', {
  eager: true,
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
 * Build a map of "locale/relative-file" → raw source string from the glob result.
 * Computed once and reused across calls.
 *
 * @type {Record<string, string>}
 */
export const markdownContentsByLocaleAndFile = (() => {
  /** @type {Record<string, string>} */
  const map = {};
  for (const [key, mod] of Object.entries(allMarkdownModules)) {
    const { locale, file } = parseGlobKey(key);
    if (!file) continue;
    // When query: '?raw' is used, the default export is the raw string
    const source = /** @type {any} */ (mod).default ?? mod;
    if (typeof source === 'string') {
      map[`${locale}/${file}`] = source;
    }
  }
  return map;
})();

/**
 * This method is responsible for retrieving a glob of all files that exist
 * within a given language directory.
 *
 * Uses import.meta.glob results (populated at Vite build/dev startup) instead
 * of runtime filesystem calls, so it works correctly in every environment
 * including the Vite RSC worker where node:fs is shimmed by unenv.
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
