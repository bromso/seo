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

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const VALID_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const NEW_RUN_ID = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"
const VALID_KEY = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeRequest(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/audit-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/audit-run", () => {
  it("returns 400 on invalid input", async () => {
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(makeRequest({ siteId: "not-a-uuid", requestedUrl: "not-a-url" }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  it("returns 401 when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns 500 on insert failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
        }),
      }),
    })
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body).toEqual({ ok: false, error: "boom" })
  })

  it("returns 200 with runId on success", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: NEW_RUN_ID }, error: null }),
      }),
    })
    mockSupabaseClient.from.mockReturnValue({ insert: insertSpy })

    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; runId: string }
    expect(body).toEqual({ ok: true, runId: NEW_RUN_ID })
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: VALID_SITE_ID,
        owner_id: VALID_USER_ID,
        requested_url: "https://example.com",
        triggered_by: "manual",
      })
    )
  })

  it("inserts with idempotency_key from header on success", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: NEW_RUN_ID }, error: null }),
      }),
    })
    mockSupabaseClient.from.mockReturnValue({ insert: insertSpy })

    const { POST } = await import("@/app/api/audit-run/route")
    const req = new Request("http://app.localhost:3001/api/audit-run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": VALID_KEY,
      },
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        requestedUrl: "https://example.com",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: VALID_KEY }))
  })

  it("returns 400 for an invalid idempotency-key header", async () => {
    const { POST } = await import("@/app/api/audit-run/route")
    const req = new Request("http://app.localhost:3001/api/audit-run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "not-a-uuid",
      },
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        requestedUrl: "https://example.com",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body).toEqual({ ok: false, error: "invalid idempotency key" })
  })

  it("returns the existing runId on Postgres 23505 unique-violation", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: NEW_RUN_ID },
                error: null,
              }),
            }),
          }),
        }),
      })

    const { POST } = await import("@/app/api/audit-run/route")
    const req = new Request("http://app.localhost:3001/api/audit-run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": VALID_KEY,
      },
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        requestedUrl: "https://example.com",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; runId: string }
    expect(body).toEqual({ ok: true, runId: NEW_RUN_ID })
  })
})
