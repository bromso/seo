import type { Db } from "@repo/db"
import { sql } from "drizzle-orm"
import { z } from "zod"

// RFC 4122 UUID pattern — permissive form that also accepts sentinel test UUIDs
// (Zod v4's z.uuid() enforces strict version/variant bits, rejecting 0000-…-0001)
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const QueueBodySchema = z.object({
  runId: z.string().regex(UUID_RE),
  siteId: z.string().regex(UUID_RE),
  ownerId: z.string().regex(UUID_RE),
  requestedUrl: z.url(),
})

export type QueueBody = z.infer<typeof QueueBodySchema>

export function parseQueueBody(input: unknown): QueueBody {
  return QueueBodySchema.parse(input)
}

export type QueuedMessage = {
  msgId: number
  readCt: number
  enqueuedAt: Date
  visibilityTimeoutAt: Date
  body: QueueBody
}

export type QueueClient = {
  read: (visibilityTimeoutSec: number) => Promise<QueuedMessage | undefined>
  ack: (msgId: number) => Promise<void>
  setVisibility: (msgId: number, additionalSec: number) => Promise<void>
  archive: (msgId: number) => Promise<void>
}

type RawRow = {
  msg_id: number | string
  read_ct: number | string
  enqueued_at: string | Date
  vt: string | Date
  message: unknown
}

/** Minimal dialect config so drizzle SQL's toQuery() can be called without a real DB dialect. */
const DEFAULT_QUERY_CONFIG = {
  escapeParam: (_idx: number, _val: unknown) => "?",
  escapeName: (name: string) => name,
  escapeString: (s: string) => s,
  inlineParams: false,
  paramStartIndex: { value: 1 },
}

/**
 * Wraps a drizzle SQL template so its `.toQuery()` can be invoked with no
 * arguments (required by the unit-test mock which calls `q.toQuery?.()`).
 */
function q(strings: TemplateStringsArray, ...values: unknown[]) {
  const fragment = sql(strings, ...values)
  const origToQuery = fragment.toQuery.bind(fragment)
  // biome-ignore lint/suspicious/noExplicitAny: patching drizzle internals for testability
  ;(fragment as any).toQuery = (config?: unknown) =>
    origToQuery((config ?? DEFAULT_QUERY_CONFIG) as never)
  return fragment
}

export function createQueueClient(db: Db, queueName = "audit_runs"): QueueClient {
  // The queue name is internal (not user input). sql.raw inlines it as a
  // literal SQL identifier so pgmq.* sees the correct string argument.
  const queue = sql.raw(`'${queueName}'`)

  return {
    async read(vtSec) {
      const rows = await db.execute(
        q`SELECT msg_id, read_ct, enqueued_at, vt, message
          FROM pgmq.read(${queue}, ${vtSec}, 1)`
      )
      const r = (rows as unknown as RawRow[])[0]
      if (!r) return undefined
      return {
        msgId: Number(r.msg_id),
        readCt: Number(r.read_ct),
        enqueuedAt: new Date(r.enqueued_at),
        visibilityTimeoutAt: new Date(r.vt),
        body: parseQueueBody(r.message),
      }
    },
    async ack(msgId) {
      await db.execute(q`SELECT pgmq.delete(${queue}, ${msgId})`)
    },
    async setVisibility(msgId, additionalSec) {
      await db.execute(q`SELECT pgmq.set_vt(${queue}, ${msgId}, ${additionalSec})`)
    },
    async archive(msgId) {
      await db.execute(q`SELECT pgmq.archive(${queue}, ${msgId})`)
    },
  }
}
