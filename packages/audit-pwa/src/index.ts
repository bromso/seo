import { withTiming } from "@repo/audit-core"
import packageJson from "../package.json" with { type: "json" }

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "pwa",
  packageName: "@repo/audit-pwa",
  packageVersion,
})(async () => {
  throw new Error("not yet implemented")
})
