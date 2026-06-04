import type { Issue } from "@repo/audit-core"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { auditRuns } from "./audit-runs.js"
import { categoryEnum, resultStatusEnum } from "./enums.js"
import { profiles } from "./profiles.js"

export const auditResults = pgTable(
  "audit_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    category: categoryEnum("category").notNull(),
    status: resultStatusEnum("status").notNull(),
    score: integer("score"),
    issues: jsonb("issues").$type<Issue[]>(),
    raw: jsonb("raw"),
    partialReasons: text("partial_reasons").array(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorRetryable: boolean("error_retryable"),
    packageName: text("package_name").notNull(),
    packageVersion: text("package_version").notNull(),
    durationMs: integer("duration_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runCategoryUniq: uniqueIndex("audit_results_run_category_idx").on(t.runId, t.category),
    ownerCategoryStartedIdx: index("audit_results_owner_category_started_idx").on(
      t.ownerId,
      t.category,
      t.startedAt.desc()
    ),
    scoreCheck: check(
      "audit_results_score_range",
      sql`score IS NULL OR (score >= 0 AND score <= 100)`
    ),
  })
)
