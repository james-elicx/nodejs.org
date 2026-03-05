import { availableLocaleCodes, defaultLocale } from '@node-core/website-i18n';
import defaultMessages from '@node-core/website-i18n/locales/en.json';
import { getRequestConfig } from 'next-intl/server';

import { deepMerge } from './util/objects';

// Statically analyzable glob import of all locale JSON files.
// Vite requires the glob pattern to be a string literal – no dynamic template
// strings – so we eagerly collect every locale file at build/dev startup and
// then pick the right one at runtime by locale code.
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  './node_modules/@node-core/website-i18n/src/locales/*.json',
  { eager: false }
);

// Loads the Application Locales/Translations Dynamically
const loadLocaleDictionary = async (locale: string) => {
  if (locale === defaultLocale.code) {
    return defaultMessages;
  }

  if (availableLocaleCodes.includes(locale)) {
    // Find the matching module loader from the glob map.
    // The glob keys are relative to the vite root (apps/site), e.g.:
    //   ../../node_modules/@node-core/website-i18n/src/locales/fr.json
    const key = Object.keys(localeModules).find(k =>
      k.endsWith(`/${locale}.json`)
    );

    if (key) {
      const { default: messages } = await localeModules[key]();
      // Use default messages as fallback
      return deepMerge(defaultMessages, messages as typeof defaultMessages);
    }
  }

  throw new Error(`Unsupported locale: ${locale}`);
};

// Provides `next-intl` configuration for RSC/SSR
export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  const rawLocale = await requestLocale;

  console.log('[i18n] requestLocale resolved to:', rawLocale);

  let locale = rawLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !availableLocaleCodes.includes(locale)) {
    console.log(
      '[i18n] locale invalid or missing, falling back to default:',
      defaultLocale.code
    );
    locale = defaultLocale.code;
  }

  console.log('[i18n] using locale:', locale);

  return {
    locale,
    // This is the dictionary of messages to be loaded
    messages: await loadLocaleDictionary(locale),
    // We always define the App timezone as UTC
    timeZone: 'Etc/UTC',
  };
});
