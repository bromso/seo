import type { Issue } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { executeRule } from "../src/executor.js"
import type { Rule, RuleContext } from "../src/rules.js"

const ctx: RuleContext = {
  $: (() => {
    throw new Error("not used in these tests")
  }) as unknown as RuleContext["$"],
  page: {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    html: "",
  },
}

const issue: Issue = {
  rule: "x/x",
  severity: "warn",
  title: "x",
  description: "x",
  recommendation: "x",
  count: 1,
  occurrences: [],
}

describe("executeRule", () => {
  it("calls runAsync when present (preferred over run)", async () => {
    const calls: string[] = []
    const rule: Rule = {
      id: "x/dual",
      weight: 1,
      run: () => {
        calls.push("run")
        return { outcome: "pass" }
      },
      runAsync: async () => {
        calls.push("runAsync")
        return { outcome: "pass" }
      },
    }
    const result = await executeRule(rule, ctx)
    expect(calls).toEqual(["runAsync"])
    expect(result.outcome).toBe("pass")
  })

  it("calls run when only run is defined", async () => {
    const rule: Rule = {
      id: "x/sync",
      weight: 1,
      run: () => ({ outcome: "fail", issues: [issue] }),
    }
    const result = await executeRule(rule, ctx)
    expect(result.outcome).toBe("fail")
    if (result.outcome === "fail") expect(result.issues[0]?.rule).toBe("x/x")
  })

  it("returns skip when no run/runAsync is defined", async () => {
    const rule: Rule = { id: "x/empty", weight: 1 }
    const result = await executeRule(rule, ctx)
    expect(result.outcome).toBe("skip")
    if (result.outcome === "skip") expect(result.reason).toBe("no implementation")
  })

  it("converts thrown Error into skip with 'unexpected:' prefix", async () => {
    const rule: Rule = {
      id: "x/throws-sync",
      weight: 1,
      run: () => {
        throw new Error("boom")
      },
    }
    const result = await executeRule(rule, ctx)
    expect(result.outcome).toBe("skip")
    if (result.outcome === "skip") expect(result.reason).toBe("unexpected: boom")
  })

  it("converts async-thrown Error into skip with 'unexpected:' prefix", async () => {
    const rule: Rule = {
      id: "x/throws-async",
      weight: 1,
      runAsync: async () => {
        throw new Error("async boom")
      },
    }
    const result = await executeRule(rule, ctx)
    expect(result.outcome).toBe("skip")
    if (result.outcome === "skip") expect(result.reason).toBe("unexpected: async boom")
  })

  it("converts thrown non-Error into skip with stringified reason", async () => {
    const rule: Rule = {
      id: "x/throws-string",
      weight: 1,
      run: () => {
        throw "string error"
      },
    }
    const result = await executeRule(rule, ctx)
    expect(result.outcome).toBe("skip")
    if (result.outcome === "skip") expect(result.reason).toBe("unexpected: string error")
  })
})
