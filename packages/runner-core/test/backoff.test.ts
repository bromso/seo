import { describe, expect, it } from "vitest"
import { sleep } from "../src/backoff.js"

describe("sleep", () => {
  it("resolves after the given ms", async () => {
    const t0 = Date.now()
    await sleep(50)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(40) // 10ms tolerance for timer skew
    expect(elapsed).toBeLessThan(200)
  })

  it("rejects with AbortError when the signal is already aborted", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(sleep(100, ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  it("rejects with AbortError when aborted mid-sleep", async () => {
    const ac = new AbortController()
    const p = sleep(1000, ac.signal)
    queueMicrotask(() => ac.abort())
    await expect(p).rejects.toMatchObject({ name: "AbortError" })
  })
})
