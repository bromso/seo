import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createBrowserClientSpy = vi.fn((..._args: unknown[]) => ({ marker: "browser-client" }))
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => createBrowserClientSpy(...args),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  createBrowserClientSpy.mockClear()
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "http://test.supabase.local"
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon-key"
  delete process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe("createBrowserSupabase", () => {
  it("memoizes the client across calls", async () => {
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    const a = createBrowserSupabase()
    const b = createBrowserSupabase()
    expect(a).toBe(b)
    expect(createBrowserClientSpy).toHaveBeenCalledTimes(1)
  })

  it("passes cookieOptions.domain when NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set", async () => {
    process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"] = ".brand.test"
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    createBrowserSupabase()
    expect(createBrowserClientSpy).toHaveBeenCalledWith("http://test.supabase.local", "anon-key", {
      cookieOptions: { domain: ".brand.test" },
    })
  })

  it("omits cookieOptions when env unset", async () => {
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    createBrowserSupabase()
    expect(createBrowserClientSpy).toHaveBeenCalledWith(
      "http://test.supabase.local",
      "anon-key",
      undefined
    )
  })
})
