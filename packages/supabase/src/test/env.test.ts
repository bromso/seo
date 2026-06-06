import { getSupabaseEnv } from "@repo/supabase/env"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const originalEnv = { ...process.env }

beforeEach(() => {
  delete process.env["NEXT_PUBLIC_SUPABASE_URL"]
  delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  delete process.env["NODE_ENV"]
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("getSupabaseEnv", () => {
  it("returns env values when both URL and key are set", () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://prod.supabase.co"
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "real-key"
    expect(getSupabaseEnv()).toEqual({
      url: "https://prod.supabase.co",
      key: "real-key",
    })
  })

  it("returns local CLI defaults when env is empty in non-production", () => {
    process.env["NODE_ENV"] = "development"
    const { url, key } = getSupabaseEnv()
    expect(url).toBe("http://127.0.0.1:54321")
    expect(key.startsWith("eyJ")).toBe(true)
    expect(key.length).toBeGreaterThan(80)
  })

  it("returns local defaults when only URL is set in non-production", () => {
    process.env["NODE_ENV"] = "development"
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://prod.supabase.co"
    expect(getSupabaseEnv().url).toBe("http://127.0.0.1:54321")
  })

  it("returns local defaults when only key is set in non-production", () => {
    process.env["NODE_ENV"] = "development"
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "partial"
    expect(getSupabaseEnv().url).toBe("http://127.0.0.1:54321")
  })

  it("throws in production when env is missing", () => {
    process.env["NODE_ENV"] = "production"
    expect(() => getSupabaseEnv()).toThrow(/must be set in production/)
  })

  it("throws in production when only URL is set", () => {
    process.env["NODE_ENV"] = "production"
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://prod.supabase.co"
    expect(() => getSupabaseEnv()).toThrow(/must be set in production/)
  })

  it("falls back to local defaults when NODE_ENV is unset", () => {
    const { url } = getSupabaseEnv()
    expect(url).toBe("http://127.0.0.1:54321")
  })
})
