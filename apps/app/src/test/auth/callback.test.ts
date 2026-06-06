// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exchangeCodeForSessionSpy = vi.fn()
const sitesSelectSpy = vi.fn()

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionSpy },
    from: () => ({ select: sitesSelectSpy }),
  })),
}))

beforeEach(() => {
  exchangeCodeForSessionSpy.mockReset()
  sitesSelectSpy.mockReset()
})
afterEach(() => vi.restoreAllMocks())

async function callGet(url: string) {
  const { GET } = await import("@/app/(auth)/auth/callback/route")
  return GET(new Request(url))
}

describe("/auth/callback GET", () => {
  it("(a) forwards provider error to /sign-in?error=access_denied", async () => {
    const res = await callGet("http://app.localhost:3001/auth/callback?error=access_denied")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://app.localhost:3001/sign-in?error=access_denied"
    )
  })

  it("(b) redirects to /sign-in?error=missing_code when code is absent", async () => {
    const res = await callGet("http://app.localhost:3001/auth/callback")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/sign-in?error=missing_code")
  })

  it("(c) forwards exchangeCodeForSession error to /sign-in?error=...", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: { message: "bad code" } })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/sign-in?error=bad%20code")
  })

  it("(d) success with 0 sites → /onboarding", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })

  it("(e) success with >0 sites → /dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(f) success with count query error → defaults to /dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: null, error: { message: "rls" } })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })
})
