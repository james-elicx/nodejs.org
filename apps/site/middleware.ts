import { availableLocaleCodes, defaultLocale } from '@node-core/website-i18n';
import createMiddleware from 'next-intl/middleware';

import type { NextRequest } from 'next/server';

const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: availableLocaleCodes,

  // Used when no locale matches
  defaultLocale: defaultLocale.code,

  // Always use a Locale as a prefix for routing
  localePrefix: 'always',

  // We already have our own way of providing alternate links
  // generated on `next.dynamic.mjs`
  alternateLinks: false,
});

export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  console.log('[middleware] incoming request:', {
    pathname,
    search,
    matchedByMatcher: true,
  });

  const response = intlMiddleware(request);

  console.log('[middleware] response:', {
    pathname,
    status: response.status,
    redirectLocation: response.headers.get('location') ?? null,
    // next-intl sets x-middleware-rewrite when it rewrites the URL internally
    rewrite: response.headers.get('x-middleware-rewrite') ?? null,
    // next-intl sets x-middleware-next when it passes the request through
    next: response.headers.get('x-middleware-next') ?? null,
  });

  return response;
}

// We only want the middleware to run on the `/` route
// to redirect users to their preferred locale
export const config = { matcher: ['/'] };
