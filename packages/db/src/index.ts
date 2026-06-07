export { createDbClient, type Db, type DbClientOptions } from "./client"
export { auditResultToInsert, insertAuditResult, insertAuditRun } from "./map"
export { canonicalUrl } from "./normalize-url"
export {
  getAuditRun,
  getCompletedCategoriesForRun,
  markAuditRunFailed,
  markAuditRunRunning,
} from "./queries"
export * as schema from "./schema/index"
export type {
  AuditResultRow,
  AuditRun,
  NewAuditResultRow,
  NewAuditRun,
  NewProfile,
  NewSite,
  Profile,
  Site,
} from "./types"
