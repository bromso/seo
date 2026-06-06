// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exchangeCodeForSessionSpy = vi.fn()
const sitesSelectSpy = vi.fn()
const cookieGetSpy = vi.fn()
const cookieDeleteSpy = vi.fn()

vi.mock("@repo/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionSpy },
    from: () => ({ select: sitesSelectSpy }),
  })),
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetSpy,
    delete: cookieDeleteSpy,
  })),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  exchangeCodeForSessionSpy.mockReset()
  sitesSelectSpy.mockReset()
  cookieGetSpy.mockReset()
  cookieDeleteSpy.mockReset()
  process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

async function callGet(url: string) {
  const { GET } = await import("@/app/auth/callback/route")
  return GET(new Request(url))
}

describe("/auth/callback GET", () => {
  it("(a) forwards provider error to /sign-in?error=access_denied", async () => {
    const res = await callGet("http://auth.localhost:3002/auth/callback?error=access_denied")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://auth.localhost:3002/sign-in?error=access_denied"
    )
  })

  it("(b) redirects to /sign-in?error=missing_code when code is absent", async () => {
    const res = await callGet("http://auth.localhost:3002/auth/callback")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://auth.localhost:3002/sign-in?error=missing_code"
    )
  })

  it("(c) forwards exchangeCodeForSession error to /sign-in?error=...", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: { message: "bad code" } })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://auth.localhost:3002/sign-in?error=bad%20code")
  })

  it("(d) success with 0 sites → ${APP_URL}/onboarding", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })

  it("(e) success with >0 sites and no redirect_to → ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(f) success with count query error → defaults to ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: null, error: { message: "rls" } })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(g) returning user with valid redirect_to → honours the redirect", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce({
      value: "http://app.localhost:3001/dashboard/runs/abc",
    })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard/runs/abc")
    expect(cookieDeleteSpy).toHaveBeenCalledWith("auth.redirect_to")
  })

  it("(h) foreign-origin redirect_to → falls back to ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce({ value: "https://evil.example/steal" })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(i) new user with valid redirect_to → onboarding still wins", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    cookieGetSpy.mockReturnValueOnce({
      value: "http://app.localhost:3001/dashboard/runs/abc",
    })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })
})
