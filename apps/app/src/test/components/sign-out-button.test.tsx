// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const clearDashboardCacheSpy = vi.fn(async () => {})
const clearAuditQueueSpy = vi.fn(async () => {})

vi.mock("@/lib/offline/clear-cache", () => ({
  clearDashboardCache: clearDashboardCacheSpy,
}))
vi.mock("@/lib/offline/audit-queue", () => ({
  clearAuditQueue: clearAuditQueueSpy,
}))

beforeEach(() => {
  clearDashboardCacheSpy.mockClear()
  clearAuditQueueSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("SignOutButton", () => {
  it("calls clearDashboardCache + clearAuditQueue before submitting the form", async () => {
    const { SignOutButton } = await import("@/components/sign-out-button")

    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {})

    render(<SignOutButton ownerId="owner-x" />)
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }))

    expect(clearDashboardCacheSpy).toHaveBeenCalledWith("owner-x")
    expect(clearAuditQueueSpy).toHaveBeenCalledWith("owner-x")
    expect(submitSpy).toHaveBeenCalledTimes(1)
  })
})
