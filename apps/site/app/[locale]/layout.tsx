import { availableLocales, defaultLocale } from '@node-core/website-i18n';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import classNames from 'classnames';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { type FC, type PropsWithChildren } from 'react';

import BaseLayout from '#site/layouts/Base';
import { VERCEL_ENV } from '#site/next.constants.mjs';
import { IBM_PLEX_MONO, OPEN_SANS } from '#site/next.fonts';
import { ThemeProvider } from '#site/providers/themeProvider';

import '#site/styles/index.css';

const fontClasses = classNames(IBM_PLEX_MONO.variable, OPEN_SANS.variable);

type RootLayoutProps = PropsWithChildren<{
  params: Promise<{ locale: string }> | { locale: string };
}>;

const RootLayout: FC<RootLayoutProps> = async ({ children, params }) => {
  // params is a Promise in Next.js 15+ (and vinext passes it as
  // Object.assign(Promise.resolve(p), p) — a resolved thenable).
  // Guard against undefined in case the layout is rendered without params
  // (e.g. during error/not-found boundary rendering in vinext).
  const resolvedParams =
    params == null
      ? ({ locale: undefined } as unknown as { locale: string })
      : typeof (params as Promise<{ locale: string }>).then === 'function'
        ? await (params as Promise<{ locale: string }>)
        : (params as { locale: string });

  const locale = resolvedParams.locale;

  // Explicitly fetch locale and messages so they are serialized into the
  // HTML payload and available on the client side. This is required for
  // client-side hooks like useTranslations (used in WithNavBar) to work
  // when Next.js error boundaries recover from a server render failure.
  // Without these props, NextIntlClientProvider relies solely on server
  // context, which is unavailable during client-side error recovery.
  const resolvedLocale = await getLocale();
  const messages = await getMessages();

  const { langDir, hrefLang } =
    availableLocales.find(l => l.code === locale) || defaultLocale;

  console.log({ resolvedLocale, locale });

  return (
    <html
      className={fontClasses}
      dir={langDir}
      lang={hrefLang}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={resolvedLocale} messages={messages}>
          <ThemeProvider>
            <BaseLayout>{children}</BaseLayout>
          </ThemeProvider>
        </NextIntlClientProvider>

        <a
          rel="me"
          aria-hidden="true"
          className="hidden"
          href="https://social.lfx.dev/@nodejs"
        />

        {VERCEL_ENV && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
};

export default RootLayout;
