import type { AuditResult } from "@repo/audit-core"
import pc from "picocolors"

const noColor = {
  green: (s: string) => s,
  yellow: (s: string) => s,
  red: (s: string) => s,
  dim: (s: string) => s,
  bold: (s: string) => s,
}

export function renderPretty(results: AuditResult[], opts: { color: boolean }): string {
  const c = opts.color ? pc : noColor
  const lines: string[] = []
  const header = `${"category".padEnd(18)} ${"status".padEnd(8)} ${"score".padStart(5)}  ${"time".padStart(7)}`
  lines.push(c.bold(header))
  lines.push(c.dim("-".repeat(header.length)))
  for (const r of results) {
    const time = `${(r.durationMs / 1000).toFixed(1)}s`
    if (r.status === "failed") {
      lines.push(
        `${r.category.padEnd(18)} ${c.red("failed".padEnd(8))} ${"—".padStart(5)}  ${time.padStart(7)}  ${c.red(r.error.code)} ${c.dim(r.error.message)}`
      )
    } else if (r.status === "partial") {
      lines.push(
        `${r.category.padEnd(18)} ${c.yellow("partial".padEnd(8))} ${String(r.score).padStart(5)}  ${time.padStart(7)}  ${c.dim(r.partialReasons.join("; "))}`
      )
    } else {
      const scoreColor = r.score >= 90 ? c.green : r.score >= 50 ? c.yellow : c.red
      lines.push(
        `${r.category.padEnd(18)} ${c.green("success".padEnd(8))} ${scoreColor(String(r.score).padStart(5))}  ${time.padStart(7)}`
      )
      for (const issue of r.issues.slice(0, 3)) {
        lines.push(`    ${c.dim("-")} ${issue.rule} ${c.dim(`(${issue.severity})`)}`)
      }
      if (r.issues.length > 3) {
        lines.push(`    ${c.dim(`… ${r.issues.length - 3} more`)}`)
      }
    }
  }
  return `${lines.join("\n")}\n`
}
