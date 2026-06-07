import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const aggregateMock = vi.fn(async () => [] as AuditResult[])
const insertAuditResultMock = vi.fn(async () => "row-id")
const markAuditRunFailedMock = vi.fn(async () => 1)
const markAuditRunRunningMock = vi.fn(async () => 1)
const getCompletedCategoriesForRunMock = vi.fn(async () => new Set<Category>())
const getAuditRunMock = vi.fn(async (id: string) => ({
  id,
  siteId: "site-1",
  ownerId: "owner-1",
  status: "queued" as const,
  requestedUrl: "https://example.com/",
}))

vi.mock("@repo/audit-cli/lib", () => ({
  aggregate: (url: string, opts: unknown, packages: unknown) => aggregateMock(url, opts, packages),
  defaultPackages: {},
}))

vi.mock("@repo/db", () => ({
  createDbClient: () => ({}),
  getAuditRun: (_db: unknown, id: string) => getAuditRunMock(id),
  getCompletedCategoriesForRun: (_db: unknown, id: string) => getCompletedCategoriesForRunMock(id),
  insertAuditResult: (_db: unknown, r: AuditResult, runId: string, ownerId: string) =>
    insertAuditResultMock(r, runId, ownerId),
  markAuditRunFailed: (_db: unknown, id: string) => markAuditRunFailedMock(id),
  markAuditRunRunning: (_db: unknown, id: string) => markAuditRunRunningMock(id),
  schema: {
    pushSubscriptions: {
      endpoint: {} as never,
      p256dh: {} as never,
      auth: {} as never,
      ownerId: {} as never,
    },
  },
}))

const queueReadMock = vi.fn()
const queueAckMock = vi.fn(async () => {})
const queueArchiveMock = vi.fn(async () => {})

vi.mock("@repo/runner-core", async () => {
  const actual = await vi.importActual<typeof import("@repo/runner-core")>("@repo/runner-core")
  return {
    ...actual,
    createQueueClient: () => ({
      read: (...args: unknown[]) => queueReadMock(...args),
      ack: (...args: unknown[]) => queueAckMock(...args),
      archive: (...args: unknown[]) => queueArchiveMock(...args),
    }),
    consoleLogger: (_e: LogEvent) => undefined,
    sleep: () => Promise.resolve(),
  }
})

const { runDaemon } = await import("../src/daemon")

const MSG = {
  msgId: 1,
  readCt: 1,
  body: {
    runId: "11111111-2222-3333-4444-555555555555",
    ownerId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    requestedUrl: "https://example.com/",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  getCompletedCategoriesForRunMock.mockResolvedValue(new Set())
  markAuditRunRunningMock.mockResolvedValue(1)
  getAuditRunMock.mockResolvedValue({
    id: MSG.body.runId,
    siteId: "site-1",
    ownerId: MSG.body.ownerId,
    status: "queued",
    requestedUrl: MSG.body.requestedUrl,
  })
})

afterEach(() => {
  vi.resetAllMocks()
})

async function runDaemonForOneMessage(): Promise<void> {
  queueReadMock.mockResolvedValueOnce(MSG)
  queueReadMock.mockImplementation(async () => {
    process.emit("SIGTERM" as never)
    return undefined
  })
  await runDaemon({
    connectionString: "postgres://unused",
    pollIntervalMs: 0,
  })
}

describe("daemon crash recovery", () => {
  it("when processRun throws (markAuditRunRunning fails), daemon marks failed + acks + survives", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    await runDaemonForOneMessage()
    expect(markAuditRunFailedMock).toHaveBeenCalledWith(MSG.body.runId)
    expect(queueAckMock).toHaveBeenCalledWith(MSG.msgId)
    const failedRows = insertAuditResultMock.mock.calls.filter(
      ([r]) => (r as AuditResult).status === "failed"
    )
    expect(failedRows.length).toBe(5)
  })

  it("when both markRunCrashed inserts AND ack succeed, message is removed", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    await runDaemonForOneMessage()
    expect(queueAckMock).toHaveBeenCalledWith(MSG.msgId)
    expect(queueArchiveMock).not.toHaveBeenCalled()
  })

  it("when markRunCrashed itself fails (insertAuditResult rejects with non-23505), message is NOT acked", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    insertAuditResultMock.mockRejectedValue(new Error("db still unreachable"))
    await runDaemonForOneMessage()
    expect(queueAckMock).not.toHaveBeenCalled()
  })
})
