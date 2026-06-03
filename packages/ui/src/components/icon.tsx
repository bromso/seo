import { Icon as IconifyIcon } from "@iconify/react"
import { cn } from "@repo/ui/lib/utils"
import type * as React from "react"

interface IconProps extends React.ComponentProps<"svg"> {
  icon: string
}

function Icon({ icon, className, ...props }: IconProps) {
  return <IconifyIcon icon={icon} className={cn("size-4 shrink-0", className)} {...props} />
}

export { Icon }
