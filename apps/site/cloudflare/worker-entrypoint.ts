// This custom worker entry point wraps vinext with Sentry instrumentation.

import { setTags, withSentry } from '@sentry/cloudflare';
import handler from 'vinext/server/fetch-handler';

import type {
  ExecutionContext,
  Iso3166Alpha2Code,
  Request,
  WorkerVersionMetadata,
} from '@cloudflare/workers-types';

const workerVersionHeader = 'X-Cloudflare-Worker-Version-Id';

type WorkerEnv = {
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /**
   * Sentry DSN, used for error monitoring.
   * If missing, Sentry isn't used.
   */
  SENTRY_DSN?: string;
};

export default withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    // Enable logs to be sent to Sentry
    enableLogs: true,
    // Set tracesSampleRate to 0.05 to capture 5% of spans for tracing.
    // Learn more at
    // https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/#tracesSampleRate
    tracesSampleRate: 0.05,
  }),
  {
    async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
      setTags({
        request_id: crypto.randomUUID(),
        user_agent: request.headers.get('user-agent'),
        ray_id: request.headers.get('cf-ray'),

        // Type casts needed to keep lsp happy
        ip_country: request.cf?.country as Iso3166Alpha2Code | undefined,
        colo: request.cf?.colo as string | undefined,
      });

      const response = await handler.fetch(request, env, ctx);
      const workerVersionId = env.CF_VERSION_METADATA?.id;

      if (!workerVersionId) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.set(workerVersionHeader, workerVersionId);

      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    },
  }
);
