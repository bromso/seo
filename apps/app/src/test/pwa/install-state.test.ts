// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DISMISS_WINDOW_MS, isDismissed, markDismissed } from "@/lib/pwa/install-state"

function installMemoryStorage(): void {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) ?? null) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k)
    },
    setItem: (k, v) => {
      store.set(k, String(v))
    },
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  })
}

beforeEach(() => {
  installMemoryStorage()
})

afterEach(() => {
  localStorage.clear()
})

describe("install-state", () => {
  it("isDismissed returns false when the key is missing", () => {
    expect(isDismissed()).toBe(false)
  })

  it("isDismissed returns true within the 30-day window", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at + DISMISS_WINDOW_MS - 1)).toBe(true)
  })

  it("isDismissed returns false after the 30-day window expires", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at + DISMISS_WINDOW_MS + 1)).toBe(false)
  })

  it("markDismissed writes a timestamp that subsequent isDismissed reads", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at)).toBe(true)
    expect(isDismissed(at + 1000)).toBe(true)
  })
})
