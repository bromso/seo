// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@repo/supabase/middleware", () => ({
  createMiddlewareSupabase: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}))

describe("middleware auth route classification", () => {
  it("treats /sign-in/email as a public auth route (no redirect for anonymous user)", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/sign-in/email") as Parameters<
      typeof middleware
    >[0]
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/sign-in/email"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it("treats /sign-up/email the same", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/sign-up/email") as Parameters<
      typeof middleware
    >[0]
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/sign-up/email"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it("still redirects /dashboard for anonymous users", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/dashboard") as Parameters<
      typeof middleware
    >[0]
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/dashboard"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/sign-in")
  })
})
