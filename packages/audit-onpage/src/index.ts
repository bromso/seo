import { withTiming } from "@repo/audit-core"
import packageJson from "../package.json" with { type: "json" }

export { fetchPage } from "./fetch.js"

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
  packageVersion,
})(async () => {
  throw new Error("not yet implemented")
})
