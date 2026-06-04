import type { AuditResult, Category } from "@repo/audit-core"

export type AuditPackages = {
  runLighthouse: (
    url: string,
    opts: { timeoutMs?: number; formFactor?: "mobile" | "desktop" }
  ) => Promise<unknown>
  perf: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  seo: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  bestPractices: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  pwa: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  onpage: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
}

export type AggregateOptions = {
  only?: Category[]
  timeoutMs?: number
  userAgent?: string
  formFactor?: "mobile" | "desktop"
}

export async function aggregate(
  url: string,
  opts: AggregateOptions,
  pkgs: AuditPackages
): Promise<AuditResult[]> {
  const wants = (c: Category) => !opts.only || opts.only.includes(c)

  const needsLh = wants("performance") || wants("seo") || wants("best-practices") || wants("pwa")

  let lhr: unknown
  if (needsLh) {
    try {
      lhr = await pkgs.runLighthouse(url, {
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.formFactor !== undefined ? { formFactor: opts.formFactor } : {}),
      })
    } catch {
      lhr = undefined
    }
  }

  const tasks: Promise<AuditResult>[] = []
  const subOpts = (extra?: object) => ({
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...extra,
  })

  if (wants("performance")) tasks.push(pkgs.perf(url, subOpts({ lighthouseResult: lhr })))
  if (wants("seo")) tasks.push(pkgs.seo(url, subOpts({ lighthouseResult: lhr })))
  if (wants("best-practices"))
    tasks.push(pkgs.bestPractices(url, subOpts({ lighthouseResult: lhr })))
  if (wants("pwa")) tasks.push(pkgs.pwa(url, subOpts({ lighthouseResult: lhr })))
  if (wants("on-page"))
    tasks.push(
      pkgs.onpage(url, subOpts(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}))
    )

  return Promise.all(tasks)
}
