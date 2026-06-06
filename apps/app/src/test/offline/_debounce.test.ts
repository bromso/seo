import { describe, expect, it, vi } from "vitest"
import { debounce } from "@/lib/offline/_debounce"

describe("debounce", () => {
  it("coalesces multiple calls within the window into one trailing invocation", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced("a")
    debounced("b")
    debounced("c")
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith("c")
    vi.useRealTimers()
  })
})
