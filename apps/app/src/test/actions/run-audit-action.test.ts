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
const VALID_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const VALID_RUN_ID = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("runAuditAction", () => {
  it("rejects invalid input", async () => {
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: "not-a-uuid",
      requestedUrl: "https://example.com",
    })
    expect(result.ok).toBe(false)
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error on DB failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "fk" } }),
        }),
      }),
    })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: false, error: "fk" })
  })

  it("returns ok with the new runId on success", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: VALID_RUN_ID },
            error: null,
          }),
        }),
      }),
    })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: true, runId: VALID_RUN_ID })
  })
})
