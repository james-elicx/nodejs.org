# Cloudflare Build and Deployment

The Node.js Website keeps its existing Next.js build and can also use
[vinext](https://github.com/cloudflare/vinext) to run the same App Router
application on Vite and deploy it to
[Cloudflare Workers](https://developers.cloudflare.com/workers/).

The two build paths are intentionally separate. `pnpm build`, `pnpm dev`, and
`pnpm start` continue to use Next.js and cache `.next`; the corresponding
`*:vinext` commands use vinext and cache `apps/site/dist`.

vinext is still under active development. Changes to routes, caching, images,
MDX, or the Worker runtime should be tested with both a production build and a
local Wrangler preview before deployment.

## Configuration

The Cloudflare deployment has three main configuration files:

- [`apps/site/vite.config.ts`](../apps/site/vite.config.ts) registers vinext,
  the Cloudflare Vite plugin, Workers Cache-backed page caching, and Cloudflare
  Images optimization.
- [`apps/site/wrangler.jsonc`](../apps/site/wrangler.jsonc) defines the Worker,
  static assets, Images binding, Workers Cache, observability, and version
  metadata.
- [`apps/site/cloudflare/worker-entrypoint.ts`](../apps/site/cloudflare/worker-entrypoint.ts)
  wraps vinext's fetch handler with Sentry instrumentation.

`next.config.mjs` remains the shared compatibility configuration, including the
existing `next-intl` plugin wrapper used by Next.js and vinext.

### Caching

Pages that opt into ISR are cached with the Cloudflare Workers Cache adapter.
The migration does not configure a separate KV data cache because the site does
not currently use `"use cache"`, `unstable_cache`, or another persistent data
cache API.

Static routes are rendered and cached on demand. They are not all pre-rendered
during the initial vinext build.

### Filesystem-backed content

The site reads Markdown pages and code snippets through Node.js filesystem APIs.
Workers do not have a normal filesystem, so
`@flarelabs-net/wrangler-build-time-fs-assets-polyfilling` inventories those
directories during the build, copies them into `dist/client`, and generates the
asset-backed filesystem implementation used by server rendering.

The filesystem asset generation must run both before the vinext build (so the
implementation can be bundled) and after it (because Vite recreates the output
directory).

### Images

`next/image` requests use vinext's Cloudflare Images optimizer through the
`IMAGES` binding. Remote source restrictions continue to come from
`next.image.config.mjs` and the Cloudflare account's image-source policy.

### Sentry

The custom Worker entry point wraps `vinext/server/fetch-handler` with
`Sentry.withSentry()`. The `CF_VERSION_METADATA` binding associates errors with
Worker versions. `SENTRY_DSN` remains an optional Worker secret.

### Version skew

The previous OpenNext-specific skew-protection service binding and variables do
not have a vinext equivalent and are not part of this deployment. Rollouts
should therefore avoid serving old HTML alongside incompatible new client
assets.

## Commands

Run these commands from the repository root:

- `pnpm build` builds the original Next.js application and caches `.next`.
- `pnpm dev` and `pnpm start` run the original Next.js application.
- `pnpm build:vinext` builds the monorepo and produces the vinext Worker in
  `apps/site/dist`.
- `pnpm dev:vinext` starts vinext development through Vite and workerd.
- `pnpm start:vinext` starts the built vinext Worker with Wrangler.
- `pnpm lint:types:vinext` generates vinext route types and type-checks the
  shared application.
- `pnpm cloudflare:preview` builds the Worker and starts a local Wrangler
  preview.
- `pnpm cloudflare:deploy` builds and deploys the Worker to Cloudflare.

The deployment workflow uses the same `cloudflare:build:worker` and
`cloudflare:deploy` package scripts, so local and CI builds share the same
output path and Wrangler configuration.
