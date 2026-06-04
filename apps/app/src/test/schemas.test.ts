import { describe, expect, it } from "vitest"
import { AddSiteSchema, RunAuditSchema, SignInSchema, SignUpSchema } from "@/lib/schemas"

describe("SignInSchema", () => {
  it("accepts a valid email + password", () => {
    expect(SignInSchema.parse({ email: "alice@example.com", password: "supersecret" })).toEqual({
      email: "alice@example.com",
      password: "supersecret",
    })
  })

  it("rejects a password shorter than 8 chars", () => {
    expect(() => SignInSchema.parse({ email: "a@b.test", password: "short" })).toThrow()
  })

  it("rejects a non-email string", () => {
    expect(() => SignInSchema.parse({ email: "not-an-email", password: "supersecret" })).toThrow()
  })
})

describe("SignUpSchema", () => {
  it("accepts an optional displayName", () => {
    const ok = SignUpSchema.parse({
      email: "a@b.test",
      password: "supersecret",
      displayName: "Alice",
    })
    expect(ok.displayName).toBe("Alice")
  })

  it("accepts no displayName", () => {
    expect(() => SignUpSchema.parse({ email: "a@b.test", password: "supersecret" })).not.toThrow()
  })

  it("rejects a displayName longer than 80 chars", () => {
    expect(() =>
      SignUpSchema.parse({
        email: "a@b.test",
        password: "supersecret",
        displayName: "a".repeat(81),
      })
    ).toThrow()
  })
})

describe("AddSiteSchema", () => {
  it("accepts a valid URL", () => {
    expect(AddSiteSchema.parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
    })
  })

  it("rejects a non-URL string", () => {
    expect(() => AddSiteSchema.parse({ url: "not a url" })).toThrow()
  })

  it("accepts an optional label", () => {
    const ok = AddSiteSchema.parse({
      url: "https://example.com",
      label: "My site",
    })
    expect(ok.label).toBe("My site")
  })
})

describe("RunAuditSchema", () => {
  it("accepts uuid siteId and url", () => {
    expect(
      RunAuditSchema.parse({
        siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        requestedUrl: "https://example.com",
      })
    ).toEqual({
      siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      requestedUrl: "https://example.com",
    })
  })

  it("rejects a non-uuid siteId", () => {
    expect(() =>
      RunAuditSchema.parse({
        siteId: "not-a-uuid",
        requestedUrl: "https://example.com",
      })
    ).toThrow()
  })
})
