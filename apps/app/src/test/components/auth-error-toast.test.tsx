// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const replaceSpy = vi.fn()
const toastErrorSpy = vi.fn()
let currentSearch = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}))
vi.mock("sonner", () => ({ toast: { error: toastErrorSpy } }))

beforeEach(() => {
  replaceSpy.mockClear()
  toastErrorSpy.mockClear()
  currentSearch = ""
})
afterEach(() => cleanup())

describe("AuthErrorToast", () => {
  it("renders null", async () => {
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    const { container } = render(<AuthErrorToast />)
    expect(container.innerHTML).toBe("")
  })

  it("fires the mapped toast and strips the param when ?error=access_denied", async () => {
    currentSearch = "error=access_denied"
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("Sign-in cancelled."))
    expect(replaceSpy).toHaveBeenCalledWith("?")
  })

  it("falls back to a generic message for unknown codes", async () => {
    currentSearch = "error=mystery_failure"
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("Sign-in failed. Try again."))
  })

  it("does not fire when there is no error param", async () => {
    currentSearch = ""
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    await waitFor(() => expect(replaceSpy).not.toHaveBeenCalled())
    expect(toastErrorSpy).not.toHaveBeenCalled()
  })
})
