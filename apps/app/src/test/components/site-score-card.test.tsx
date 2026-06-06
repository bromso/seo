// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

const { SiteScoreCard } = await import("@/components/site-score-card")

const SITE = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  url: "https://example.com",
  normalized_url: "https://example.com/",
  label: null,
  is_competitor: false,
  created_at: "2026-06-05T12:00:00Z",
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 50))
    return new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 })
  })
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SiteScoreCard Run button", () => {
  it("fires only one /api/audit-run request on a rapid double-click", async () => {
    render(<SiteScoreCard ownerId={SITE.owner_id} site={SITE} scores={[]} selfScores={null} />)
    const button = screen.getByRole("button", { name: /run audit/i })
    const user = userEvent.setup()
    await user.click(button)
    await user.click(button)
    await new Promise((r) => setTimeout(r, 100))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
