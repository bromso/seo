// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import OfflinePage from "@/app/offline/page"

describe("OfflinePage", () => {
  it("renders the offline headline and a Try Again button", () => {
    render(<OfflinePage />)
    expect(screen.getByText(/you're offline/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy()
  })
})
