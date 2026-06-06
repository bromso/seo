import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cookieStoreGetAll = vi.fn(() => [])
const cookieStoreSet = vi.fn()
const createServerClientSpy = vi.fn((..._args: unknown[]) => ({ marker: "server-client" }))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: cookieStoreGetAll,
    set: cookieStoreSet,
  })),
}))
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientSpy(...args),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  cookieStoreGetAll.mockClear()
  cookieStoreSet.mockClear()
  createServerClientSpy.mockClear()
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "http://test.supabase.local"
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon-key"
  delete process.env["AUTH_COOKIE_DOMAIN"]
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe("createServerSupabase", () => {
  it("calls createServerClient with the env URL + anon key and a cookie adapter", async () => {
    const { createServerSupabase } = await import("@repo/supabase/server")
    const client = await createServerSupabase()
    expect(client).toEqual({ marker: "server-client" })
    expect(createServerClientSpy).toHaveBeenCalledWith(
      "http://test.supabase.local",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) })
    )
  })

  it("setAll injects domain from AUTH_COOKIE_DOMAIN when set", async () => {
    process.env["AUTH_COOKIE_DOMAIN"] = ".brand.test"
    const { createServerSupabase } = await import("@repo/supabase/server")
    await createServerSupabase()
    const cookieAdapter = createServerClientSpy.mock.calls[0]![2] as {
      cookies: {
        setAll: (c: { name: string; value: string; options: Record<string, unknown> }[]) => void
      }
    }
    cookieAdapter.cookies.setAll([
      { name: "sb-access", value: "v1", options: { httpOnly: true, path: "/" } },
    ])
    expect(cookieStoreSet).toHaveBeenCalledWith("sb-access", "v1", {
      httpOnly: true,
      path: "/",
      domain: ".brand.test",
    })
  })

  it("setAll omits domain when AUTH_COOKIE_DOMAIN is not set", async () => {
    const { createServerSupabase } = await import("@repo/supabase/server")
    await createServerSupabase()
    const cookieAdapter = createServerClientSpy.mock.calls[0]![2] as {
      cookies: {
        setAll: (c: { name: string; value: string; options: Record<string, unknown> }[]) => void
      }
    }
    cookieAdapter.cookies.setAll([{ name: "sb-access", value: "v1", options: { path: "/" } }])
    expect(cookieStoreSet).toHaveBeenCalledWith("sb-access", "v1", { path: "/" })
  })
})
