'use strict';

import { basename, extname } from 'node:path';

// Eagerly import all download snippet files across all locales at Vite
// build/dev startup. The glob pattern must be a string literal for Vite's
// static analysis. Each entry is imported as a raw string via ?raw so no
// further parsing is needed.
//
// Glob keys are relative to this file, e.g.:
//   "../../snippets/en/download/nvm.bash"
//   "../../snippets/fr/download/brew.bash"
const snippetModules = import.meta.glob('../../snippets/*/download/*.bash', {
  eager: true,
  query: '?raw',
});

/**
 * Parse a glob key into its locale, filename, and extension components.
 *
 * Key format: "../../snippets/<locale>/download/<name>.<ext>"
 *
 * @param {string} key
 * @returns {{ locale: string; name: string; language: string } | null}
 */
function parseSnippetKey(key) {
  // Normalise to forward slashes (Windows safety)
  const normalised = key.replace(/\\/g, '/');

  // Match  …/snippets/<locale>/download/<filename>
  const match = normalised.match(/\/snippets\/([^/]+)\/download\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const [, locale, filename] = match;

  return {
    locale,
    name: basename(filename, extname(filename)),
    language: extname(filename).slice(1),
  };
}

/**
 * Generates the Node.js Website Download Snippets for self-consumption
 * during RSC and Static Builds.
 *
 * Uses Vite's import.meta.glob (resolved at build/dev startup) instead of
 * node:fs/promises so this module works correctly inside the Cloudflare
 * Workers / Miniflare RSC environment where node:fs is not available.
 *
 * @returns {Promise<Map<string, import('../../types').DownloadSnippet[]>>}
 */
export default async function generateDownloadSnippets() {
  /** @type {Map<string, import('../../types').DownloadSnippet[]>} */
  const result = new Map();

  for (const [key, mod] of Object.entries(snippetModules)) {
    const parsed = parseSnippetKey(key);

    if (!parsed) {
      continue;
    }

    const { locale, name, language } = parsed;

    // import.meta.glob with query: '?raw' sets the default export to the
    // raw file content string.
    const content = /** @type {any} */ (mod).default ?? mod;

    if (typeof content !== 'string') {
      continue;
    }

    const snippet = /** @type {import('../../types').DownloadSnippet} */ ({
      name,
      language,
      content,
    });

    const existing = result.get(locale);

    if (existing) {
      existing.push(snippet);
    } else {
      result.set(locale, [snippet]);
    }
  }

  return result;
}
