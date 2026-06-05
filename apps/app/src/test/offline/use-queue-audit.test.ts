// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const URL_X = "https://example.com"

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

afterEach(() => {
  _resetOfflineDBCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useQueueAudit", () => {
  it("returns { ok:true, runId } on a successful online fetch and does NOT enqueue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 }))
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r).toEqual({ ok: true, runId: "r1" })
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("enqueues on network error and returns { ok:true, queued:true, queueId }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      })
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r.ok).toBe(true)
    if (r.ok && "queued" in r) {
      expect(r.queued).toBe(true)
      expect(typeof r.queueId).toBe("string")
      const db = await openOfflineDB()
      const entries = await readQueueForOwner(db, OWNER)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        id: r.queueId,
        ownerId: OWNER,
        siteId: SITE,
        requestedUrl: URL_X,
      })
    } else {
      throw new Error("expected queued result")
    }
  })

  it("returns the server error without queueing when online and server says !ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 }))
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r).toEqual({ ok: false, error: "HTTP 500" })
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("enqueues a non-ok server response when navigator.onLine is false", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 503 }))
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r.ok).toBe(true)
    if (r.ok && "queued" in r) {
      expect(r.queued).toBe(true)
    } else {
      throw new Error("expected queued result")
    }
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toHaveLength(1)
  })

  it("sends an idempotency-key header on every POST", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchSpy)
    const { result } = renderHook(() => useQueueAudit(OWNER))
    await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0]
    const init = call?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
