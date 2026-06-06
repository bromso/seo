// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@repo/supabase/browser", () => ({
  createBrowserSupabase: () => ({ auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } }),
}))

afterEach(() => {
  cleanup()
})

describe("/sign-in/email page", () => {
  it("renders the email + password form and a back link to /sign-in", async () => {
    const { default: Page } = await import("@/app/(auth)/sign-in/email/page")
    render(Page())
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    const back = screen.getByRole("link", { name: /login options/i })
    expect(back.getAttribute("href")).toBe("/sign-in")
  })
})

describe("/sign-up/email page", () => {
  it("renders display name + email + password and a back link to /sign-up", async () => {
    const { default: Page } = await import("@/app/(auth)/sign-up/email/page")
    render(Page())
    expect(screen.getByLabelText(/display name/i)).toBeDefined()
    expect(screen.getByLabelText(/^email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    const back = screen.getByRole("link", { name: /sign-up options/i })
    expect(back.getAttribute("href")).toBe("/sign-up")
  })
})
