import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@repo/supabase/server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const VALID_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("removeCompetitorAction", () => {
  it("rejects invalid uuid", async () => {
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction("not-a-uuid")
    expect(result).toEqual({ ok: false, error: "invalid site id" })
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error on DB failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "fk constraint" } }),
        }),
      }),
    })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: false, error: "fk constraint" })
  })

  it("returns ok and uses is_competitor=true guard to prevent deleting self-site", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const competitorEq = vi.fn().mockResolvedValue({ error: null })
    const idEq = vi.fn().mockReturnValue({ eq: competitorEq })
    mockSupabaseClient.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({ eq: idEq }),
    })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: true })
    expect(idEq).toHaveBeenCalledWith("id", VALID_SITE_ID)
    expect(competitorEq).toHaveBeenCalledWith("is_competitor", true)
  })
})
