// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const signInWithOAuthSpy = vi.fn()
const redirectSpy = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`)
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { signInWithOAuth: signInWithOAuthSpy },
  })),
}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "http://app.localhost:3001" })),
}))
vi.mock("next/navigation", () => ({
  redirect: redirectSpy,
}))

beforeEach(() => {
  signInWithOAuthSpy.mockReset()
  redirectSpy.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe("startOAuthAction", () => {
  it("calls signInWithOAuth with the right provider and a redirectTo derived from the Origin", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: "https://google.com/oauth?x=1" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("google")).rejects.toThrow(
      "__REDIRECT__:https://google.com/oauth?x=1"
    )
    expect(signInWithOAuthSpy).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://app.localhost:3001/auth/callback", scopes: undefined },
    })
  })

  it("passes GitHub scopes when provider is github", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: "https://github.com/oauth" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("github")).rejects.toThrow("__REDIRECT__:")
    expect(signInWithOAuthSpy).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "http://app.localhost:3001/auth/callback",
        scopes: "read:user user:email",
      },
    })
  })

  it("redirects to /sign-in?error=... when the SDK returns an error", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("azure")).rejects.toThrow("__REDIRECT__:/sign-in?error=boom")
  })

  it("redirects to /sign-in?error=oauth_unavailable when data.url is missing without an error", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: null } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("azure")).rejects.toThrow(
      "__REDIRECT__:/sign-in?error=oauth_unavailable"
    )
  })
})
