// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const mockUser: { user: null | { id: string } } = { user: null }
vi.mock("@repo/supabase/middleware", () => ({
  createMiddlewareSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser.user } }) },
  }),
}))

function makeReq(url: string) {
  const req = new Request(url) as Parameters<typeof import("@/middleware").middleware>[0]
  Object.defineProperty(req, "nextUrl", { value: new URL(url) })
  Object.defineProperty(req, "cookies", { value: { getAll: () => [] } })
  return req
}

describe("apps/app middleware", () => {
  it("anonymous user on /dashboard → 307 to ${AUTH_URL}/sign-in?redirect_to=…", async () => {
    process.env["NEXT_PUBLIC_AUTH_URL"] = "http://auth.localhost:3002"
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/dashboard"))
    expect(res.status).toBe(307)
    const loc = res.headers.get("location")
    expect(loc).toContain("http://auth.localhost:3002/sign-in")
    expect(loc).toContain(
      `redirect_to=${encodeURIComponent("http://app.localhost:3001/dashboard")}`
    )
  })

  it("authed user on /dashboard passes through", async () => {
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/dashboard"))
    expect(res.status).toBe(200)
  })

  it("anonymous user on /sign-out still passes through (POST can fire)", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/sign-out"))
    expect(res.status).toBe(200)
  })

  it("anonymous user on / passes through (public root)", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/"))
    expect(res.status).toBe(200)
  })
})
