import { AuditFailure } from "@repo/audit-core"
import type { LaunchedChrome } from "chrome-launcher"
import { launch as chromeLaunch } from "chrome-launcher"
import lighthouse from "lighthouse"
import { mapHttpStatus, mapLhrRuntimeError, mapThrownError } from "./map-error.js"
import { project } from "./project.js"
import type { LighthouseRunOptions, RawLighthouseResult } from "./types.js"

const DEFAULT_TIMEOUT = 60_000

export async function runLighthouse(
  url: string,
  opts: LighthouseRunOptions = {}
): Promise<RawLighthouseResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  const formFactor = opts.formFactor ?? "mobile"
  const noSandbox = process.env["LH_NO_SANDBOX"] === "1"

  const chromeFlags = ["--headless=new", ...(noSandbox ? ["--no-sandbox"] : [])]

  if (opts.signal?.aborted) {
    throw new AuditFailure({ code: "ABORTED", message: "aborted before launch" })
  }

  let chrome: LaunchedChrome | undefined
  const abortHandler = () => {
    void chrome?.kill()
  }
  opts.signal?.addEventListener("abort", abortHandler, { once: true })

  try {
    chrome = await chromeLaunch({ chromeFlags })
    opts.logger?.({ kind: "debug", message: `chrome on port ${chrome.port}` })

    const lhFlags = {
      port: chrome.port,
      output: "json" as const,
      logLevel: "error" as const,
      formFactor,
      onlyCategories: ["performance", "seo", "best-practices", "pwa"],
      ...(formFactor === "desktop"
        ? {
            screenEmulation: {
              mobile: false as const,
              width: 1350,
              height: 940,
              deviceScaleFactor: 1,
              disabled: false as const,
            },
          }
        : {}),
    }

    const runnerResult = await withTimeout(lighthouse(url, lhFlags), timeoutMs)

    if (!runnerResult) {
      throw new AuditFailure({
        code: "LIGHTHOUSE_CRASH",
        message: "lighthouse returned no result",
      })
    }

    const lhr = runnerResult.lhr as unknown as Parameters<typeof project>[0] & {
      runtimeError?: { code: string; message: string }
    }

    if (lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR") {
      throw mapLhrRuntimeError(lhr.runtimeError)
    }

    // HTTP status check via main-document audit if available
    const mainDoc = lhr.audits["main-document-request"]
    const finalStatus = (mainDoc?.details?.items?.[0] as { statusCode?: number } | undefined)
      ?.statusCode
    if (typeof finalStatus === "number" && finalStatus >= 400) {
      throw mapHttpStatus(finalStatus)
    }

    return project(lhr)
  } catch (err) {
    throw mapThrownError(err)
  } finally {
    opts.signal?.removeEventListener("abort", abortHandler)
    await chrome?.kill()
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`operation timed out after ${ms}ms`)
          ;(err as { code?: string }).code = "ETIMEDOUT"
          reject(err)
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
