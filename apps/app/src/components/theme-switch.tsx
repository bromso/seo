"use client"

import { Icon } from "@iconify/react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useTheme } from "next-themes"

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="scale-95 rounded-full">
              <Icon
                icon="lucide:sun"
                className="size-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
              />
              <Icon
                icon="lucide:moon"
                className="absolute size-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
              />
              <span className="sr-only">Toggle theme</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Theme</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light{" "}
          <Icon
            icon="lucide:check"
            width={14}
            height={14}
            className={cn("ml-auto", theme !== "light" && "hidden")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
          <Icon
            icon="lucide:check"
            width={14}
            height={14}
            className={cn("ml-auto", theme !== "dark" && "hidden")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
          <Icon
            icon="lucide:check"
            width={14}
            height={14}
            className={cn("ml-auto", theme !== "system" && "hidden")}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
