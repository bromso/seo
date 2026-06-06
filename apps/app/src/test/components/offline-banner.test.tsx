// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OfflineBanner } from "@/components/offline-banner"

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

describe("OfflineBanner", () => {
  it("renders nothing when navigator.onLine is true on mount", () => {
    render(<OfflineBanner />)
    expect(screen.queryByText(/You are offline/i)).toBeNull()
  })

  it("renders the banner when navigator starts offline", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
  })

  it("shows the banner after the window 'offline' event fires", () => {
    render(<OfflineBanner />)
    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: false,
      })
      window.dispatchEvent(new Event("offline"))
    })
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
  })

  it("hides the banner after the window 'online' event fires", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      })
      window.dispatchEvent(new Event("online"))
    })
    expect(screen.queryByText(/You are offline/i)).toBeNull()
  })

  it("shows cache age in the message when offline and cachedAt is provided", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    render(<OfflineBanner cachedAt={fiveMinAgo} />)
    expect(screen.getByText(/cached 5m ago/i)).toBeTruthy()
  })

  it("falls back to default message when offline and cachedAt is undefined", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByText(/last data we cached on this device/i)).toBeTruthy()
  })

  it("renders empty markup on SSR even when navigator is offline (hydration-safe)", () => {
    // Simulates server-side rendering. renderToStaticMarkup runs only the
    // initial render — no effects. If the component reads navigator.onLine
    // during initial render, the SSR output won't match client hydration.
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    const html = renderToStaticMarkup(<OfflineBanner />)
    expect(html).toBe("")
  })
})
