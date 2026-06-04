import { describe, expect, it, vi } from "vitest"
import { createQueueClient, parseQueueBody } from "../src/queue.js"

describe("parseQueueBody", () => {
  it("accepts a well-formed body", () => {
    const body = {
      runId: "00000000-0000-0000-0000-000000000001",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "https://example.com",
    }
    expect(parseQueueBody(body)).toEqual(body)
  })

  it("rejects a body with missing fields", () => {
    expect(() => parseQueueBody({ runId: "x" })).toThrow()
  })

  it("rejects a body where runId is not a uuid", () => {
    const body = {
      runId: "not-a-uuid",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "https://example.com",
    }
    expect(() => parseQueueBody(body)).toThrow()
  })

  it("rejects a body where requestedUrl is not a URL", () => {
    const body = {
      runId: "00000000-0000-0000-0000-000000000001",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "not a url",
    }
    expect(() => parseQueueBody(body)).toThrow()
  })
})

describe("createQueueClient", () => {
  // Light mock: we only verify that .execute is called with SQL whose
  // serialized form mentions the expected pgmq function name.
  function makeMockDb(rows: unknown[]) {
    const calls: { sql: string; params: unknown[] }[] = []
    const db = {
      execute: vi.fn(async (q: unknown) => {
        // Drizzle SQL fragments expose .toQuery() — { sql, params }
        const queryable = q as {
          toQuery?: () => { sql: string; params: unknown[] }
          sql?: string
        }
        const tq = queryable.toQuery?.()
        calls.push({
          sql: tq?.sql ?? queryable.sql ?? String(q),
          params: tq?.params ?? [],
        })
        return rows
      }),
    }
    return { db, calls }
  }

  it("read() invokes pgmq.read and parses one message", async () => {
    const message = {
      msg_id: 42,
      read_ct: 1,
      enqueued_at: new Date("2026-06-04T12:00:00Z").toISOString(),
      vt: new Date("2026-06-04T12:10:00Z").toISOString(),
      message: {
        runId: "00000000-0000-0000-0000-000000000001",
        siteId: "00000000-0000-0000-0000-000000000002",
        ownerId: "00000000-0000-0000-0000-000000000003",
        requestedUrl: "https://example.com",
      },
    }
    const { db, calls } = makeMockDb([message])
    const queue = createQueueClient(db as never, "audit_runs")
    const m = await queue.read(600)
    expect(m?.msgId).toBe(42)
    expect(m?.readCt).toBe(1)
    expect(m?.body.runId).toBe(message.message.runId)
    expect(m?.enqueuedAt).toBeInstanceOf(Date)
    expect(calls[0]?.sql).toMatch(/pgmq\.read/)
  })

  it("read() returns undefined when no message", async () => {
    const { db } = makeMockDb([])
    const queue = createQueueClient(db as never, "audit_runs")
    expect(await queue.read(600)).toBeUndefined()
  })

  it("ack() invokes pgmq.delete", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.ack(42)
    expect(calls[0]?.sql).toMatch(/pgmq\.delete/)
  })

  it("setVisibility() invokes pgmq.set_vt", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.setVisibility(42, 300)
    expect(calls[0]?.sql).toMatch(/pgmq\.set_vt/)
  })

  it("archive() invokes pgmq.archive", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.archive(42)
    expect(calls[0]?.sql).toMatch(/pgmq\.archive/)
  })

  it("read() rejects when the message body is malformed", async () => {
    const malformed = {
      msg_id: 99,
      read_ct: 1,
      enqueued_at: new Date().toISOString(),
      vt: new Date().toISOString(),
      message: { runId: "not-a-uuid" }, // missing fields + bad uuid
    }
    const { db } = makeMockDb([malformed])
    const queue = createQueueClient(db as never, "audit_runs")
    await expect(queue.read(60)).rejects.toThrow()
  })
})
