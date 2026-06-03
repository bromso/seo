"use client"

import { Icon } from "@iconify/react"
import { Button } from "@repo/ui/components/button"
import { useTheme } from "next-themes"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="outline"
      size="icon"
      className="size-9"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <Icon
        icon="lucide:sun"
        className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90"
      />
      <Icon
        icon="lucide:moon"
        className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
