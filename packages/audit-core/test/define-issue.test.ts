import { describe, expect, it } from "vitest"
import { defineIssue, IssueSchema } from "../src/index.js"

describe("defineIssue", () => {
  it("produces a valid Issue with defaults", () => {
    const issue = defineIssue({
      rule: "onpage/title-missing",
      severity: "error",
      title: "Title missing",
      description: "No <title> element.",
      recommendation: "Add a 30-60 character page title.",
    })
    expect(() => IssueSchema.parse(issue)).not.toThrow()
    expect(issue.count).toBe(1)
    expect(issue.occurrences).toEqual([])
  })

  it("truncates occurrences to first 5 and preserves count", () => {
    const issue = defineIssue({
      rule: "onpage/alt-missing",
      severity: "warn",
      title: "Images missing alt text",
      description: "12 images missing alt.",
      recommendation: "Add alt attributes.",
      occurrences: Array.from({ length: 12 }, (_, i) => ({
        selector: `img:nth-of-type(${i + 1})`,
      })),
    })
    expect(issue.count).toBe(12)
    expect(issue.occurrences).toHaveLength(5)
    expect(issue.occurrences[0]?.selector).toBe("img:nth-of-type(1)")
    expect(() => IssueSchema.parse(issue)).not.toThrow()
  })

  it("respects explicit count when given", () => {
    const issue = defineIssue({
      rule: "onpage/alt-missing",
      severity: "warn",
      title: "Images missing alt text",
      description: "12 images missing alt.",
      recommendation: "Add alt attributes.",
      count: 42,
      occurrences: [{ selector: "img.hero" }],
    })
    expect(issue.count).toBe(42)
  })

  it("truncates snippet to 200 chars", () => {
    const long = "x".repeat(500)
    const issue = defineIssue({
      rule: "onpage/heading-order-broken",
      severity: "warn",
      title: "Broken heading order",
      description: "An h3 appears before any h2.",
      recommendation: "Reorder headings.",
      occurrences: [{ snippet: long }],
    })
    expect(issue.occurrences[0]?.snippet?.length).toBe(200)
  })
})
