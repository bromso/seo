import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type * as s from "./schema/index.js"

export type Profile = InferSelectModel<typeof s.profiles>
export type NewProfile = InferInsertModel<typeof s.profiles>
export type Site = InferSelectModel<typeof s.sites>
export type NewSite = InferInsertModel<typeof s.sites>
export type AuditRun = InferSelectModel<typeof s.auditRuns>
export type NewAuditRun = InferInsertModel<typeof s.auditRuns>
export type AuditResultRow = InferSelectModel<typeof s.auditResults>
export type NewAuditResultRow = InferInsertModel<typeof s.auditResults>
