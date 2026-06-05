// @vitest-environment happy-dom
import "fake-indexeddb/auto"

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enqueueAuditRun, type QueuedAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

function entry(id: string): QueuedAuditRun {
  return {
    id,
    ownerId: OWNER,
    siteId: "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5",
    requestedUrl: "https://example.com",
    queuedAt: 1,
  }
}

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
})

afterEach(() => {
  cleanup()
  _resetOfflineDBCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useAuditQueueReplay", () => {
  it("drains a non-empty queue on mount when online and removes successful entries", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toEqual([])
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("drains the queue when the window 'online' event fires", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))
    // While offline, mount-fire is skipped — no drain yet.
    expect(fetchMock).not.toHaveBeenCalled()

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    window.dispatchEvent(new Event("online"))

    await waitFor(async () => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toEqual([])
    })
  })

  it("retains entries whose replay fetch returns !ok", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    let i = 0
    const fetchMock = vi.fn(async () => {
      i += 1
      if (i === 1) {
        return new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toHaveLength(1)
      expect(left[0]?.id).toBe("q2")
    })
  })
})

describe("useAuditQueueReplay — toast aggregation", () => {
  it("emits a single aggregated success toast for a multi-entry drain", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))
    await enqueueAuditRun(db, entry("q3"))

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, runId: "rid" }), { status: 200 }))
    )

    const successMock = toast.success as ReturnType<typeof vi.fn>
    successMock.mockClear()

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      expect(await readQueueForOwner(db, OWNER)).toEqual([])
    })

    expect(successMock).toHaveBeenCalledTimes(1)
    expect(successMock).toHaveBeenCalledWith(expect.stringMatching(/Started 3 queued audit/))
  })
})
