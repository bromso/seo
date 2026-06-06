// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerBackgroundSync } from "@/lib/offline/background-sync"

type FakeReg = { sync?: { register: (tag: string) => Promise<void> } }

function installFakeServiceWorker(reg: FakeReg): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(reg),
    },
  })
}

function uninstallFakeServiceWorker(): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  })
}

beforeEach(() => {
  uninstallFakeServiceWorker()
})

afterEach(() => {
  uninstallFakeServiceWorker()
  vi.restoreAllMocks()
})

describe("registerBackgroundSync", () => {
  it("returns true and calls sync.register when the API is available", async () => {
    const register = vi.fn(async () => undefined)
    installFakeServiceWorker({ sync: { register } })

    const result = await registerBackgroundSync("audit-run-queue")
    expect(result).toBe(true)
    expect(register).toHaveBeenCalledWith("audit-run-queue")
  })

  it("returns false silently when sync is not available", async () => {
    installFakeServiceWorker({})

    const result = await registerBackgroundSync("audit-run-queue")
    expect(result).toBe(false)
  })
})
