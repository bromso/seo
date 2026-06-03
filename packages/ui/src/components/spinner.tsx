import { Icon } from "@iconify/react"
import { cn } from "@repo/ui/lib/utils"
import type * as React from "react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Icon
      icon="lucide:loader-2"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
