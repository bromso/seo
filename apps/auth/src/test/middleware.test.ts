// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const mockUser: { user: null | { id: string } } = { user: null }
vi.mock("@repo/supabase/middleware", () => ({
  createMiddlewareSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser.user } }) },
  }),
}))

const originalEnv = { ...process.env }
function makeReq(url: string) {
  const req = new Request(url) as Parameters<typeof import("@/middleware").middleware>[0]
  Object.defineProperty(req, "nextUrl", { value: new URL(url) })
  Object.defineProperty(req, "cookies", { value: { getAll: () => [] } })
  return req
}

describe("apps/auth middleware", () => {
  it("anonymous user on /sign-in passes through (200)", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in"))
    expect(res.status).toBe(200)
  })

  it("authed user on /sign-in → 307 to ${APP_URL}/dashboard", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
    process.env = { ...originalEnv }
  })

  it("authed user on /sign-in/email also bounces", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in/email"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
    process.env = { ...originalEnv }
  })

  it("authed user on /auth/callback does not bounce (callback owns its own logic)", async () => {
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/auth/callback?code=x"))
    expect(res.status).toBe(200)
  })

  it("anon user on /sign-in?redirect_to=… captures the URL in auth.redirect_to cookie", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const url =
      "http://auth.localhost:3002/sign-in?redirect_to=http%3A%2F%2Fapp.localhost%3A3001%2Fdashboard"
    const res = await middleware(makeReq(url))
    expect(res.status).toBe(200)
    const setCookie = res.cookies.get("auth.redirect_to")
    expect(setCookie?.value).toBe("http://app.localhost:3001/dashboard")
    expect(setCookie?.httpOnly).toBe(true)
    expect(setCookie?.sameSite).toBe("lax")
  })

  it("anon user on /sign-up?redirect_to=… captures the URL too", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const url =
      "http://auth.localhost:3002/sign-up?redirect_to=http%3A%2F%2Fapp.localhost%3A3001%2Fdashboard"
    const res = await middleware(makeReq(url))
    expect(res.cookies.get("auth.redirect_to")?.value).toBe("http://app.localhost:3001/dashboard")
  })

  it("no redirect_to param → no cookie set", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in"))
    expect(res.cookies.get("auth.redirect_to")).toBeUndefined()
  })

  it("redirect_to on a non-auth path → no cookie set", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(
      makeReq("http://auth.localhost:3002/auth/callback?redirect_to=http%3A%2F%2Fx")
    )
    expect(res.cookies.get("auth.redirect_to")).toBeUndefined()
  })
})
