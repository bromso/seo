import { withTiming } from "@repo/audit-core"
import packageJson from "../package.json" with { type: "json" }

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "best-practices",
  packageName: "@repo/audit-best-practices",
  packageVersion,
})(async () => {
  throw new Error("not yet implemented")
})
