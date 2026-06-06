// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isPushSupported, subscribeToPush, urlBase64ToUint8Array } from "@/lib/push/subscribe"

const VAPID_KEY =
  "BPaQy0u9ZbW7y0Cik5HG3kSVB-Gz5W2kS5JqsHxNVZi0M3Vu_FsZ40fAB2sSqx1uHvGwOklTcZQI4qY-9MCRWiE"

type FakeSubscription = {
  endpoint: string
  toJSON: () => { keys?: { p256dh?: string; auth?: string } }
  unsubscribe: () => Promise<void>
}

function installFakeServiceWorker(opts: {
  subscription?: FakeSubscription | null
  subscribeImpl?: (init: PushSubscriptionOptionsInit) => Promise<FakeSubscription>
}): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(async () => opts.subscription ?? null),
          subscribe: opts.subscribeImpl ?? vi.fn(),
        },
      }),
    },
  })
}

function uninstallFakeServiceWorker(): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  })
}

function setNotification(permission: NotificationPermission): void {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn(async () => permission),
    },
  })
}

function clearNotification(): void {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: undefined,
  })
}

beforeEach(() => {
  uninstallFakeServiceWorker()
  clearNotification()
})

afterEach(() => {
  uninstallFakeServiceWorker()
  clearNotification()
  vi.restoreAllMocks()
})

describe("urlBase64ToUint8Array", () => {
  it("converts a known VAPID public key to the expected Uint8Array prefix", () => {
    const out = urlBase64ToUint8Array(VAPID_KEY)
    // VAPID public keys are 65-byte ECDH P-256 keys starting with 0x04
    expect(out.length).toBe(65)
    expect(out[0]).toBe(0x04)
  })
})

describe("isPushSupported", () => {
  it("returns false when serviceWorker is absent", () => {
    expect(isPushSupported()).toBe(false)
  })
})

describe("subscribeToPush", () => {
  it("returns null when Notification permission is denied", async () => {
    installFakeServiceWorker({})
    setNotification("denied")
    const result = await subscribeToPush(VAPID_KEY)
    expect(result).toBeNull()
  })

  it("calls pushManager.subscribe with userVisibleOnly + key and returns payload on grant", async () => {
    const subscribeImpl = vi.fn(async (_init: PushSubscriptionOptionsInit) => ({
      endpoint: "https://push.example.com/abc",
      toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => {},
    }))
    installFakeServiceWorker({ subscribeImpl })
    setNotification("granted")

    const result = await subscribeToPush(VAPID_KEY)
    expect(subscribeImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      })
    )
    expect(result).toEqual({
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p", auth: "a" },
    })
  })
})
