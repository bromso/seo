// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const startOAuthActionSpy = vi.fn()
vi.mock("@/app/auth/start/actions", () => ({
  startOAuthAction: startOAuthActionSpy,
}))

afterEach(() => cleanup())

describe("OAuthProviderForm", () => {
  it("renders a form whose button submits with the right provider label", async () => {
    const { OAuthProviderForm } = await import("@/components/oauth-provider-form")
    render(
      <OAuthProviderForm provider="google" label="Continue with Google" icon={<span data-icon />} />
    )
    const button = screen.getByRole("button", { name: /continue with google/i })
    expect(button.getAttribute("type")).toBe("submit")
    const form = button.closest("form")
    expect(form).not.toBeNull()
  })

  it("forwards tone='primary' to the underlying button", async () => {
    const { OAuthProviderForm } = await import("@/components/oauth-provider-form")
    render(
      <OAuthProviderForm
        provider="github"
        label="Continue with GitHub"
        icon={<span />}
        tone="primary"
      />
    )
    const button = screen.getByRole("button", { name: /continue with github/i })
    expect(button.className).toMatch(/bg-brand-accent/)
  })
})
