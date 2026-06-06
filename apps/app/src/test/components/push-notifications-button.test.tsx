// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/push/subscribe", () => ({
  isPushSupported: vi.fn(),
  getCurrentSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}))

import { PushNotificationsButton } from "@/components/push-notifications-button"
import { getCurrentSubscription, isPushSupported, subscribeToPush } from "@/lib/push/subscribe"

const supportedMock = isPushSupported as ReturnType<typeof vi.fn>
const getSubMock = getCurrentSubscription as ReturnType<typeof vi.fn>
const subMock = subscribeToPush as ReturnType<typeof vi.fn>

beforeEach(() => {
  supportedMock.mockReset()
  getSubMock.mockReset()
  subMock.mockReset()
  vi.stubEnv(
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "BPaQy0u9ZbW7y0Cik5HG3kSVB-Gz5W2kS5JqsHxNVZi0M3Vu_FsZ40fAB2sSqx1uHvGwOklTcZQI4qY-9MCRWiE"
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("PushNotificationsButton", () => {
  it("renders nothing when push isn't supported", async () => {
    supportedMock.mockReturnValue(false)
    const { container } = render(<PushNotificationsButton />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector("button")).toBeNull()
  })

  it("subscribes on Enable click, POSTs, and re-renders as Disable", async () => {
    supportedMock.mockReturnValue(true)
    getSubMock.mockResolvedValue(null)
    subMock.mockResolvedValue({
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p", auth: "a" },
    })

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)

    render(<PushNotificationsButton />)
    const user = userEvent.setup()

    const enableBtn = await screen.findByRole("button", { name: /enable notifications/i })
    await user.click(enableBtn)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disable notifications/i })).toBeTruthy()
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/push-subscribe",
      expect.objectContaining({ method: "POST" })
    )
  })
})
