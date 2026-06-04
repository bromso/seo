import { AuditFailure, withTiming } from "@repo/audit-core"
import { type RawLighthouseResult, runLighthouse } from "@repo/lighthouse-runner"
import packageJson from "../package.json" with { type: "json" }
import { projectSeo } from "./rules.js"

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-seo",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr =
    (opts?.lighthouseResult as RawLighthouseResult | undefined) ??
    (await runLighthouse(url, {
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts?.formFactor !== undefined ? { formFactor: opts.formFactor } : {}),
    }))
  if (!lhr.categories.seo) {
    throw new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: "lighthouse result missing seo category",
    })
  }
  return projectSeo(lhr)
})
