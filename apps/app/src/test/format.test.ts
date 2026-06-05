import { describe, expect, it } from "vitest"
import { formatRelativeTime, formatScore, scoreColorClass, statusBadgeVariant } from "@/lib/format"

describe("formatScore", () => {
  it("returns '—' when score is null", () => {
    expect(formatScore(null)).toBe("—")
  })

  it("rounds to integer", () => {
    expect(formatScore(87.4)).toBe("87")
    expect(formatScore(87.6)).toBe("88")
  })

  it("clamps to 0..100", () => {
    expect(formatScore(150)).toBe("100")
    expect(formatScore(-10)).toBe("0")
  })
})

describe("scoreColorClass", () => {
  it("returns green for >= 90", () => {
    expect(scoreColorClass(95)).toBe("text-green-600")
    expect(scoreColorClass(90)).toBe("text-green-600")
  })

  it("returns yellow for 50..89", () => {
    expect(scoreColorClass(89)).toBe("text-yellow-600")
    expect(scoreColorClass(50)).toBe("text-yellow-600")
  })

  it("returns red for < 50", () => {
    expect(scoreColorClass(49)).toBe("text-red-600")
    expect(scoreColorClass(0)).toBe("text-red-600")
  })

  it("returns muted for null", () => {
    expect(scoreColorClass(null)).toBe("text-muted-foreground")
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-05T12:00:00.000Z")

  it("formats seconds ago", () => {
    const t = new Date(now.getTime() - 30_000)
    expect(formatRelativeTime(t, now)).toBe("30s ago")
  })

  it("formats minutes ago", () => {
    const t = new Date(now.getTime() - 5 * 60_000)
    expect(formatRelativeTime(t, now)).toBe("5m ago")
  })

  it("formats hours ago", () => {
    const t = new Date(now.getTime() - 3 * 3600_000)
    expect(formatRelativeTime(t, now)).toBe("3h ago")
  })

  it("formats days ago", () => {
    const t = new Date(now.getTime() - 2 * 86400_000)
    expect(formatRelativeTime(t, now)).toBe("2d ago")
  })

  it("uses 'just now' for < 10 seconds", () => {
    const t = new Date(now.getTime() - 5_000)
    expect(formatRelativeTime(t, now)).toBe("just now")
  })

  it("accepts ISO strings", () => {
    expect(formatRelativeTime("2026-06-05T11:55:00.000Z", now)).toBe("5m ago")
  })
})

describe("statusBadgeVariant", () => {
  it("maps each run status to a Shadcn badge variant", () => {
    expect(statusBadgeVariant("queued")).toBe("secondary")
    expect(statusBadgeVariant("running")).toBe("default")
    expect(statusBadgeVariant("completed")).toBe("default")
    expect(statusBadgeVariant("partial")).toBe("outline")
    expect(statusBadgeVariant("failed")).toBe("destructive")
  })
})
