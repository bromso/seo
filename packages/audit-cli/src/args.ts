import { CategorySchema } from "@repo/audit-core"
import { Command, Option } from "commander"
import { z } from "zod"

export type CliArgs = {
  url: string
  only?: Array<z.infer<typeof CategorySchema>>
  json: boolean
  pretty: boolean
  formFactor: "mobile" | "desktop"
  timeout: number
  userAgent?: string
  noColor: boolean
  debug: boolean
}

const FormFactor = z.enum(["mobile", "desktop"])

export function parseArgs(argv: string[]): CliArgs {
  const program = new Command()
    .name("audit-cli")
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .argument("<url>", "URL to audit")
    .option("--json", "output JSON to stdout")
    .option("--pretty", "output a pretty table to stdout")
    .option("--only <list>", "comma-separated categories")
    .addOption(
      new Option("--form-factor <ff>", "lighthouse form factor")
        .choices(["mobile", "desktop"])
        .default("mobile")
    )
    .option("--timeout <ms>", "per-audit timeout", "30000")
    .option("--user-agent <ua>", "user-agent for audit-onpage")
    .option("--no-color", "disable ANSI colors")
    .option("--debug", "verbose progress + chrome stderr")
    .allowExcessArguments(false)

  let parsed: ReturnType<typeof program.parse>
  try {
    parsed = program.parse(argv, { from: "node" })
  } catch (err) {
    if ((err as { code?: string }).code === "commander.missingArgument") {
      throw new Error("url is required")
    }
    throw err
  }

  const opts = parsed.opts<{
    json?: boolean
    pretty?: boolean
    only?: string
    formFactor: "mobile" | "desktop"
    timeout: string
    userAgent?: string
    color: boolean
    debug?: boolean
  }>()
  const [url] = parsed.processedArgs as [string]

  // Validate URL via zod
  try {
    z.url().parse(url)
  } catch {
    throw new Error(`invalid URL: ${url}`)
  }

  if (opts.json && opts.pretty) {
    throw new Error("--json and --pretty are mutually exclusive")
  }

  let only: CliArgs["only"]
  if (opts.only) {
    const parts = opts.only.split(",").map((s) => s.trim())
    only = parts.map((p) => {
      const r = CategorySchema.safeParse(p)
      if (!r.success) throw new Error(`unknown category: ${p}`)
      return r.data
    })
  }

  return {
    url,
    json: opts.json ?? false,
    pretty: opts.pretty ?? false,
    formFactor: FormFactor.parse(opts.formFactor),
    timeout: Number.parseInt(opts.timeout, 10),
    noColor: !opts.color,
    debug: opts.debug ?? false,
    ...(only !== undefined ? { only } : {}),
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
  }
}
