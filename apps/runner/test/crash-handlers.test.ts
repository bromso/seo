import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { installCrashHandlers, markRunCrashed } from "../src/daemon"

describe("installCrashHandlers", () => {
  let teardown: (() => void) | undefined

  afterEach(() => {
    teardown?.()
    teardown = undefined
  })

  it("adds unhandledRejection + uncaughtException listeners and removes them on teardown", () => {
    const before = {
      rej: process.listenerCount("unhandledRejection"),
      exc: process.listenerCount("uncaughtException"),
    }
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    expect(process.listenerCount("unhandledRejection")).toBe(before.rej + 1)
    expect(process.listenerCount("uncaughtException")).toBe(before.exc + 1)
    teardown()
    teardown = undefined
    expect(process.listenerCount("unhandledRejection")).toBe(before.rej)
    expect(process.listenerCount("uncaughtException")).toBe(before.exc)
  })

  it("logs (and does not exit) when an unhandled rejection is fired", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("unhandledRejection", new Error("simulated"), Promise.resolve())
    await new Promise((r) => setImmediate(r))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.kind).toBe("warn")
    expect(logs[0]?.message).toContain("unhandledRejection")
    expect(logs[0]?.message).toContain("simulated")
  })

  it("logs (and does not exit) when an uncaught exception is fired", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("uncaughtException", new Error("uncaught boom"))
    await new Promise((r) => setImmediate(r))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.kind).toBe("warn")
    expect(logs[0]?.message).toContain("uncaughtException")
    expect(logs[0]?.message).toContain("uncaught boom")
  })

  it("stringifies non-Error rejection reasons", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("unhandledRejection", "string reason", Promise.resolve())
    await new Promise((r) => setImmediate(r))
    expect(logs[0]?.message).toContain("string reason")
  })
})

describe("markRunCrashed", () => {
  const REQUESTED_URL = "https://example.com/"
  const RUN_ID = "11111111-2222-3333-4444-555555555555"
  const OWNER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  const MSG_ID = 42

  function makeDeps(
    overrides: {
      completedCategories?: Set<Category>
      insertReject?: Error
      markFailedReturns?: number
    } = {}
  ) {
    const inserted: AuditResult[] = []
    const insertSpy = vi.fn(async (r: AuditResult) => {
      if (overrides.insertReject) throw overrides.insertReject
      inserted.push(r)
      return "row-id"
    })
    const markFailedSpy = vi.fn(async () => overrides.markFailedReturns ?? 1)
    const getCompletedSpy = vi.fn(
      async () => overrides.completedCategories ?? (new Set() as Set<Category>)
    )
    const ackSpy = vi.fn(async () => {})
    const logs: LogEvent[] = []
    return {
      inserted,
      insertSpy,
      markFailedSpy,
      getCompletedSpy,
      ackSpy,
      logs,
      args: {
        db: {} as never,
        queue: { ack: ackSpy } as never,
        msgId: MSG_ID,
        runId: RUN_ID,
        ownerId: OWNER_ID,
        requestedUrl: REQUESTED_URL,
        errorMessage: "lighthouse session closed",
        logger: (e: LogEvent) => logs.push(e),
        getCompletedCategoriesForRun: getCompletedSpy,
        insertAuditResult: insertSpy,
        markAuditRunFailed: markFailedSpy,
      },
    }
  }

  it("inserts synthetic failures for all 5 categories, marks run failed, acks", async () => {
    const t = makeDeps()
    await markRunCrashed(t.args)
    expect(t.inserted).toHaveLength(5)
    const categories = t.inserted.map((r) => r.category).sort()
    expect(categories).toEqual(["best-practices", "on-page", "performance", "pwa", "seo"])
    for (const r of t.inserted) {
      expect(r.status).toBe("failed")
      expect(r.url).toBe(REQUESTED_URL)
      expect(r.requestedUrl).toBe(REQUESTED_URL)
      if (r.status === "failed") {
        expect(r.error.message).toBe("lighthouse session closed")
        expect(r.error.code).toBe("UNKNOWN")
      }
    }
    expect(t.markFailedSpy).toHaveBeenCalledWith(RUN_ID)
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("skips categories that already have a row", async () => {
    const t = makeDeps({ completedCategories: new Set(["seo", "on-page"]) as Set<Category> })
    await markRunCrashed(t.args)
    const categories = t.inserted.map((r) => r.category).sort()
    expect(categories).toEqual(["best-practices", "performance", "pwa"])
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("treats Postgres 23505 (unique violation) on insert as benign and continues", async () => {
    const t = makeDeps()
    let first = true
    t.args.insertAuditResult = async (r) => {
      if (first) {
        first = false
        const err = new Error("duplicate key") as Error & { code?: string }
        err.code = "23505"
        throw err
      }
      t.inserted.push(r)
      return "row-id"
    }
    await markRunCrashed(t.args)
    expect(t.inserted).toHaveLength(4)
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("does NOT ack if a non-23505 insert error happens", async () => {
    const t = makeDeps({ insertReject: new Error("db connection lost") })
    await expect(markRunCrashed(t.args)).rejects.toThrow("db connection lost")
    expect(t.ackSpy).not.toHaveBeenCalled()
    expect(t.markFailedSpy).not.toHaveBeenCalled()
  })

  it("does NOT ack if markAuditRunFailed throws", async () => {
    const t = makeDeps()
    t.args.markAuditRunFailed = async () => {
      throw new Error("update failed")
    }
    await expect(markRunCrashed(t.args)).rejects.toThrow("update failed")
    expect(t.ackSpy).not.toHaveBeenCalled()
  })
})
