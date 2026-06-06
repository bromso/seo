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
const NEW_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

function setupSitesMocks(opts: {
  count: number | null
  countError?: { message: string }
  insertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const firstCall = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          count: opts.count,
          error: opts.countError ?? null,
        }),
      }),
    }),
  }
  const secondCall = opts.insertResult
    ? {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(opts.insertResult),
          }),
        }),
      }
    : undefined

  mockSupabaseClient.from
    .mockReturnValueOnce(firstCall)
    .mockReturnValueOnce(secondCall ?? firstCall)
}

describe("addCompetitorAction", () => {
  it("rejects invalid input (bad URL)", async () => {
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "not a url" })
    expect(result.ok).toBe(false)
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error when at the 5-competitor limit", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({ count: 5 })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("limit reached"),
    })
  })

  it("returns error on count query failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({ count: null, countError: { message: "count failed" } })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "count failed" })
  })

  it("returns error on insert failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({
      count: 2,
      insertResult: { data: null, error: { message: "duplicate" } },
    })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "duplicate" })
  })

  it("returns ok with new site id on success + normalizes the URL", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: NEW_SITE_ID },
          error: null,
        }),
      }),
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ insert: insertSpy })

    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({
      url: "https://Competitor.TEST/?utm_source=x",
      label: "Comp A",
    })
    expect(result).toEqual({ ok: true, siteId: NEW_SITE_ID })
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        url: "https://Competitor.TEST/?utm_source=x",
        normalized_url: "https://competitor.test/",
        label: "Comp A",
        is_competitor: true,
      })
    )
  })

  it("does not insert an empty-string label (form submitted with blank field)", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: NEW_SITE_ID }, error: null }),
      }),
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ insert: insertSpy })

    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({
      url: "https://competitor.test",
      label: "",
    })
    expect(result.ok).toBe(true)
    const insertedRow = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertedRow).not.toHaveProperty("label")
  })
})
