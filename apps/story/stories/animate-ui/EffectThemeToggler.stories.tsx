import React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ThemeToggler,
  type ThemeSelection,
  type Resolved,
} from "@repo/ui/components/animate-ui/primitives/effects/theme-toggler"

const meta = {
  title: "Animate UI/Effects/ThemeToggler",
  component: ThemeToggler,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    direction: {
      control: "select",
      options: ["ltr", "rtl", "ttb", "btt"],
    },
  },
  args: {
    direction: "ltr",
  },
} satisfies Meta<typeof ThemeToggler>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => {
    const [theme, setTheme] = React.useState<ThemeSelection>("light")
    const resolved: Resolved = theme === "system" ? "light" : theme

    return (
      <ThemeToggler
        {...args}
        theme={theme}
        resolvedTheme={resolved}
        setTheme={setTheme}
      >
        {({ resolved: currentResolved, toggleTheme }) => (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Current theme: <strong>{currentResolved}</strong>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => toggleTheme("light")}
              >
                Light
              </button>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => toggleTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => toggleTheme("system")}
              >
                System
              </button>
            </div>
          </div>
        )}
      </ThemeToggler>
    )
  },
}

export const RightToLeft: Story = {
  render: (args) => {
    const [theme, setTheme] = React.useState<ThemeSelection>("light")
    const resolved: Resolved = theme === "system" ? "light" : theme

    return (
      <ThemeToggler
        {...args}
        theme={theme}
        resolvedTheme={resolved}
        setTheme={setTheme}
      >
        {({ resolved: currentResolved, toggleTheme }) => (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Direction: RTL | Theme: <strong>{currentResolved}</strong>
            </p>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => toggleTheme(currentResolved === "light" ? "dark" : "light")}
            >
              Toggle Theme
            </button>
          </div>
        )}
      </ThemeToggler>
    )
  },
  args: {
    direction: "rtl",
  },
}
