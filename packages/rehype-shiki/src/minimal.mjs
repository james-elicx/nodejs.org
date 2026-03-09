import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';

import createHighlighter from '#rs/highlighter.mjs';

/** @type {Array<() => Promise<import('@shikijs/types').LanguageRegistration[]>>} */
export const LANGS = [
  () => import('shiki/langs/powershell.mjs').then(m => m.default),
  () => import('shiki/langs/shellscript.mjs').then(m => m.default),
];

export const getLanguageDisplayName = language => language;

export const { shiki, highlightToHast, highlightToHtml } =
  await createHighlighter({
    coreOptions: {
      // For the minimal (web) Shiki, we want to use the simpler,
      // JavaScript based engine.
      engine: createJavaScriptRegexEngine(),
      langs: LANGS,
    },
  });
