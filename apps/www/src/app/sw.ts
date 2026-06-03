import { defaultCache } from "@serwist/next/worker"
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist"
import { CacheFirst, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist"

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // HTML pages - Network first with offline fallback
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "www-pages",
        networkTimeoutSeconds: 3,
      }),
    },
    // Static assets - Cache first
    {
      matcher: ({ request }) =>
        request.destination === "style" ||
        request.destination === "script" ||
        request.destination === "font",
      handler: new CacheFirst({
        cacheName: "www-static-assets",
      }),
    },
    // Images - Stale while revalidate
    {
      matcher: ({ request }) => request.destination === "image",
      handler: new StaleWhileRevalidate({
        cacheName: "www-images",
      }),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()
