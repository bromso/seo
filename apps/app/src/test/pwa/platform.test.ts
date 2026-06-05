import { describe, expect, it } from "vitest"
import { isIosSafari } from "@/lib/pwa/platform"

const UA = {
  iphoneSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadSafari17:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  firefoxIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const

describe("isIosSafari", () => {
  it("returns true for iPhone Mobile Safari", () => {
    expect(isIosSafari(UA.iphoneSafari17)).toBe(true)
  })
  it("returns true for iPad Mobile Safari", () => {
    expect(isIosSafari(UA.ipadSafari17)).toBe(true)
  })
  it("returns false for Chrome on iOS (CriOS)", () => {
    expect(isIosSafari(UA.chromeIOS)).toBe(false)
  })
  it("returns false for Firefox on iOS (FxiOS)", () => {
    expect(isIosSafari(UA.firefoxIOS)).toBe(false)
  })
  it("returns false for Chrome on Android", () => {
    expect(isIosSafari(UA.androidChrome)).toBe(false)
  })
  it("returns false for desktop Chrome", () => {
    expect(isIosSafari(UA.desktopChrome)).toBe(false)
  })
})
