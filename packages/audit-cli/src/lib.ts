import { audit as auditBP } from "@repo/audit-best-practices"
import { audit as auditOnpage } from "@repo/audit-onpage"
import { audit as auditPerf } from "@repo/audit-perf"
import { audit as auditPwa } from "@repo/audit-pwa"
import { audit as auditSeo } from "@repo/audit-seo"
import { runLighthouse } from "@repo/lighthouse-runner"
import type { AuditPackages } from "./aggregate.js"

export { type AggregateOptions, type AuditPackages, aggregate } from "./aggregate.js"

export const defaultPackages: AuditPackages = {
  runLighthouse: (u, o) => runLighthouse(u, o),
  perf: (u, o) => auditPerf(u, o),
  seo: (u, o) => auditSeo(u, o),
  bestPractices: (u, o) => auditBP(u, o),
  pwa: (u, o) => auditPwa(u, o),
  onpage: (u, o) => auditOnpage(u, o),
}
