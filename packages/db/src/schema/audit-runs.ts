import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { runStatusEnum } from "./enums.js"
import { profiles } from "./profiles.js"
import { sites } from "./sites.js"

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("queued"),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by").notNull().default("manual"),
  },
  (t) => ({
    siteStartedAtIdx: index("audit_runs_site_started_idx").on(t.siteId, t.startedAt.desc()),
    ownerIdx: index("audit_runs_owner_idx").on(t.ownerId),
    statusIdx: index("audit_runs_status_idx").on(t.status),
  })
)
