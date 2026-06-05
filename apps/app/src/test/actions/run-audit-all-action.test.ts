import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE_A = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const SITE_B = "9b9c8b3a-1c4d-4f6a-92b6-9f0a8e8b7c3d"
const RUN_A = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"
const RUN_B = "c2e3d4e5-b6c7-4a89-a123-4567890abcdf"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("runAuditAllAction", () => {
  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error when user has no sites", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })
    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: false, error: "no sites" })
  })

  it("returns partial-error message when one insert fails mid-loop", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: SITE_A, url: "https://a.test" },
              { id: SITE_B, url: "https://b.test" },
            ],
            error: null,
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_A }, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "boom" },
            }),
          }),
        }),
      })

    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({
      ok: false,
      error: "boom (after 1 succeeded)",
    })
  })

  it("returns ok with N runIds for N sites", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: SITE_A, url: "https://a.test" },
              { id: SITE_B, url: "https://b.test" },
            ],
            error: null,
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_A }, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_B }, error: null }),
          }),
        }),
      })

    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: true, runIds: [RUN_A, RUN_B] })
  })
})
