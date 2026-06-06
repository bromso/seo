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
const VALID_ENDPOINT = "https://push.example.com/abc"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makePost(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/push-subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDelete(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/push-subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/push-subscribe", () => {
  it("returns 401 when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import("@/app/api/push-subscribe/route")
    const res = await POST(
      makePost({
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 200 and inserts on a valid authenticated POST", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })

    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn().mockReturnValue({ eq: deleteEqSpy })

    mockSupabaseClient.from
      .mockReturnValueOnce({ delete: deleteSpy })
      .mockReturnValueOnce({ insert: insertSpy })

    const { POST } = await import("@/app/api/push-subscribe/route")
    const res = await POST(
      makePost({
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
        userAgent: "test/1.0",
      })
    )

    expect(res.status).toBe(200)
    expect(deleteEqSpy).toHaveBeenCalledWith("endpoint", VALID_ENDPOINT)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        endpoint: VALID_ENDPOINT,
        p256dh: "p",
        auth: "a",
        user_agent: "test/1.0",
      })
    )
  })
})

describe("DELETE /api/push-subscribe", () => {
  it("returns 200 and deletes on a valid authenticated DELETE", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })

    const ownerEqSpy = vi.fn().mockResolvedValue({ error: null })
    const endpointEqSpy = vi.fn().mockReturnValue({ eq: ownerEqSpy })
    const deleteSpy = vi.fn().mockReturnValue({ eq: endpointEqSpy })
    mockSupabaseClient.from.mockReturnValue({ delete: deleteSpy })

    const { DELETE } = await import("@/app/api/push-subscribe/route")
    const res = await DELETE(makeDelete({ endpoint: VALID_ENDPOINT }))

    expect(res.status).toBe(200)
    expect(endpointEqSpy).toHaveBeenCalledWith("endpoint", VALID_ENDPOINT)
    expect(ownerEqSpy).toHaveBeenCalledWith("owner_id", VALID_USER_ID)
  })
})
