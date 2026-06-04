import type { LogEvent } from "@repo/audit-core"

export type Logger = (event: LogEvent) => void

/**
 * Default logger: writes structured JSON to stderr.
 */
export const consoleLogger: Logger = (event) => {
  const line = JSON.stringify({ time: new Date().toISOString(), ...event })
  process.stderr.write(`${line}\n`)
}

/**
 * No-op logger for tests.
 */
export const silentLogger: Logger = () => {}
