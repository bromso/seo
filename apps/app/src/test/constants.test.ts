import { describe, expect, it } from "vitest"
import { CATEGORIES, MAX_COMPETITORS, TRENDS_WINDOW_DAYS } from "@/lib/constants"

describe("constants", () => {
  it("MAX_COMPETITORS is 5 (per the brief)", () => {
    expect(MAX_COMPETITORS).toBe(5)
  })

  it("TRENDS_WINDOW_DAYS is 30", () => {
    expect(TRENDS_WINDOW_DAYS).toBe(30)
  })

  it("CATEGORIES contains exactly the 5 slice-1 categories in order", () => {
    expect([...CATEGORIES]).toEqual(["performance", "seo", "best-practices", "pwa", "on-page"])
  })
})
