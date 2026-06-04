import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// We use vi.hoisted to construct mocks that the module-under-test's imports
// will resolve before evaluation.
const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((p: string) => {
    throw new Error(`__REDIRECT__${p}`)
  }),
}))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("addSiteAction", () => {
  it("returns ok:false when input is invalid", async () => {
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "not a url" })
    expect(result).toMatchObject({ ok: false })
  })

  it("returns ok:false when user is missing", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "https://example.com" })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns ok:false when DB insert fails", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: "duplicate" } }),
    })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "https://example.com" })
    expect(result).toEqual({ ok: false, error: "duplicate" })
  })

  it("redirects to /dashboard on success (throws the redirect sentinel)", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    await expect(addSiteAction({ url: "https://example.com", label: "My site" })).rejects.toThrow(
      "__REDIRECT__/dashboard"
    )
  })

  it("normalizes the URL before insert", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    mockSupabaseClient.from.mockReturnValue({ insert: insertSpy })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    try {
      await addSiteAction({ url: "https://Example.COM/?utm_source=x" })
    } catch {
      // expected redirect throw
    }
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        url: "https://Example.COM/?utm_source=x",
        normalized_url: "https://example.com/",
        is_competitor: false,
      })
    )
  })
})
