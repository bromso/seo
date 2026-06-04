import { Command } from "commander"
import { z } from "zod"
import { runDaemon } from "./daemon.js"
import { enqueueOne } from "./enqueue.js"

const DEFAULT_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

export function buildCli(): Command {
  const program = new Command().name("runner").description("audit runner daemon and helpers")

  program
    .command("start", { isDefault: true })
    .description("start the poll-loop daemon")
    .option(
      "--connection-string <url>",
      "Postgres connection string",
      process.env["DATABASE_URL"] ?? DEFAULT_DB
    )
    .option("--poll-interval-ms <ms>", "ms to sleep when queue is empty", "1000")
    .option("--visibility-timeout-sec <sec>", "pgmq visibility timeout", "600")
    .action(
      async (opts: {
        connectionString: string
        pollIntervalMs: string
        visibilityTimeoutSec: string
      }) => {
        await runDaemon({
          connectionString: opts.connectionString,
          pollIntervalMs: Number.parseInt(opts.pollIntervalMs, 10),
          visibilityTimeoutSec: Number.parseInt(opts.visibilityTimeoutSec, 10),
        })
      }
    )

  program
    .command("enqueue")
    .description("manually enqueue an audit run for testing")
    .argument("<url>", "URL to audit")
    .option(
      "--owner-id <uuid>",
      "owner profile id (or DEFAULT_OWNER_ID env)",
      process.env["DEFAULT_OWNER_ID"]
    )
    .option("--site-id <uuid>", "site id (defaults to owner's self-site)")
    .option("--label <string>", "site label (only used if creating)")
    .option(
      "--connection-string <url>",
      "Postgres connection string",
      process.env["DATABASE_URL"] ?? DEFAULT_DB
    )
    .action(
      async (
        url: string,
        opts: {
          ownerId?: string
          siteId?: string
          label?: string
          connectionString: string
        }
      ) => {
        if (!opts.ownerId) {
          process.stderr.write("runner: --owner-id is required (or set DEFAULT_OWNER_ID)\n")
          process.exit(2)
        }
        z.url().parse(url)
        const runId = await enqueueOne({
          url,
          ownerId: opts.ownerId,
          connectionString: opts.connectionString,
          ...(opts.siteId !== undefined && { siteId: opts.siteId }),
          ...(opts.label !== undefined && { label: opts.label }),
        })
        process.stdout.write(`runId: ${runId}\n`)
      }
    )

  return program
}
