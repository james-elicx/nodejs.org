import { bindings, defineConfig, defineWorker } from "@cloudflare/vite-plugin/experimental-config";
import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";

const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: "nodejs-website-response-store",
    compatibilityDate: "2026-09-26",
		compatibilityFlags: ["nodejs_compat"],
		observability: {
			enabled: true
    }
  },
  bucket: "nodejs-website-response-store-cache-bodies",
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  accountId: 'd48e2eb599d9aa075d5e682deaecc518',
  worker: defineWorker({
    ...responseStore.applicationWorker,
    name: "nodejs-website",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-26",
    compatibilityFlags: ["nodejs_compat"],
		assets: { notFoundHandling: "none" },
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
			IMAGES: bindings.images(),

			VINEXT_BUILD_TIME_ISR: bindings.text("true"),
      NEXT_PUBLIC_STATIC_EXPORT_LOCALE: bindings.text("false"),
		},
		observability: {
			enabled: true,
			headSamplingRate: 1,
			logs: {
				enabled: true,
				headSamplingRate: 1,
				invocationLogs: true,
				persist:true
			},
			traces: {
				enabled: true,
				headSamplingRate: 1,
				persist:true
			}
    },
  }),
});
