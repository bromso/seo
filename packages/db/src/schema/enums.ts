import { pgEnum } from "drizzle-orm/pg-core"

export const categoryEnum = pgEnum("category", [
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
])

export const resultStatusEnum = pgEnum("result_status", ["success", "partial", "failed"])

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
])
