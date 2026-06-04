import { withTiming } from "@repo/audit-core"
import { type RawLighthouseResult, runLighthouse } from "@repo/lighthouse-runner"
import packageJson from "../package.json" with { type: "json" }
import { projectPwa } from "./rules.js"

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "pwa",
  packageName: "@repo/audit-pwa",
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
  const projection = projectPwa(lhr)
  if (projection.kind === "missing") {
    return {
      score: projection.score,
      issues: [],
      raw: projection.raw,
      partialReasons: projection.partialReasons,
    }
  }
  return {
    score: projection.score,
    issues: projection.issues,
    raw: projection.raw,
  }
})
