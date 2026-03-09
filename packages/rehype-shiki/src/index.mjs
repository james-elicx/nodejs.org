import createHighlighter from '#rs/highlighter.mjs';

/**
 * @typedef {Object} HighlighterOptions
 * @property {boolean} [wasm=false] - Enable WebAssembly for the regex engine
 * @property {boolean} [twoslash=false] - Enable twoslash
 * @property {import('@shikijs/twoslash').TransformerTwoslashIndexOptions} [twoslashOptions] - Twoslash configuration options
 * @property {import('@shikijs/core').HighlighterCoreOptions} [coreOptions] - Core options for the highlighter.
 * @property {import('@shikijs/core').CodeToHastOptions} [highlighterOptions] - Additional options for highlighting.
 */

/**
 * Creates the appropriate regex engine based on configuration
 * @param {HighlighterOptions} options - Configuration options
 */
async function getEngine({ wasm = false }) {
  if (wasm) {
    const { createOnigurumaEngine } = await import('@shikijs/engine-oniguruma');
    return createOnigurumaEngine(await import('shiki/wasm'));
  }

  const { createJavaScriptRegexEngine } =
    await import('@shikijs/engine-javascript');
  return createJavaScriptRegexEngine();
}

/**
 * Configures and returns transformers based on options
 * @param {HighlighterOptions} options - Configuration options
 */
async function getTransformers({ twoslash = false, twoslashOptions }) {
  const transformers = [];

  if (twoslash) {
    const { twoslash } = await import('#rs/transformers/twoslash/index.mjs');
    transformers.push(twoslash(twoslashOptions));
  }

  return transformers;
}

/** @type {Array<() => Promise<import('@shikijs/types').LanguageRegistration[]>>} */
export const LANGS = [
  () => import('shiki/langs/c.mjs').then(m => m.default),
  () => import('shiki/langs/coffeescript.mjs').then(m => m.default),
  () => import('shiki/langs/cpp.mjs').then(m => m.default),
  () => import('shiki/langs/diff.mjs').then(m => m.default),
  () => import('shiki/langs/docker.mjs').then(m => m.default),
  () => import('shiki/langs/http.mjs').then(m => m.default),
  () => import('shiki/langs/ini.mjs').then(m => m.default),
  () =>
    import('shiki/langs/javascript.mjs').then(m => [
      { ...m.default[0], aliases: m.default[0].aliases.concat('cjs', 'mjs') },
    ]),
  () => import('shiki/langs/json.mjs').then(m => m.default),
  () => import('shiki/langs/powershell.mjs').then(m => m.default),
  () => import('shiki/langs/shellscript.mjs').then(m => m.default),
  () => import('shiki/langs/shellsession.mjs').then(m => m.default),
  () => import('shiki/langs/typescript.mjs').then(m => m.default),
  () => import('shiki/langs/yaml.mjs').then(m => m.default),
];

export const getLanguageDisplayName = language => language;

/**
 * Creates and configures a syntax highlighter
 * @param {HighlighterOptions} options - Configuration options
 */
export default async (options = {}) =>
  createHighlighter({
    coreOptions: {
      ...options.coreOptions,
      langs: LANGS,
      engine: await getEngine(options),
    },
    highlighterOptions: {
      ...options.highlighterOptions,
      transformers: await getTransformers(options),
    },
  });
