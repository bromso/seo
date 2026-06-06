import { defaultCache } from "@serwist/next/worker"
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist"
import { CacheFirst, NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist"
import { openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

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
    // API routes - Network only (no caching for auth/data)
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // GraphQL requests - Network first with short cache
    {
      matcher: ({ url }) => url.pathname.includes("graphql"),
      handler: new NetworkFirst({
        cacheName: "app-graphql",
        networkTimeoutSeconds: 5,
      }),
    },
    // Dashboard pages - Network first for fresh data
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "app-pages",
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
        cacheName: "app-static-assets",
      }),
    },
    // Images - Stale while revalidate
    {
      matcher: ({ request }) => request.destination === "image",
      handler: new StaleWhileRevalidate({
        cacheName: "app-images",
      }),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()

self.addEventListener("sync", (event) => {
  const e = event as Event & { tag?: string; waitUntil: (p: Promise<unknown>) => void }
  if (e.tag !== "audit-run-queue") return
  e.waitUntil(
    (async () => {
      const db = await openOfflineDB()
      const result = await replayAuditQueueOnce(db, fetch)
      if (result.failures > 0) {
        throw new Error(`replay had ${result.failures} failure(s)`)
      }
    })()
  )
})
