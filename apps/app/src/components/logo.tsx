import { cn } from "@repo/ui/lib/utils"
import Image from "next/image"

interface LogoProps {
  className?: string
  width?: number
  height?: number
  symbol?: boolean
  color?: "primary" | "secondary" | string
  size?: "sm" | "md" | "lg" | string
}

const sizeMap = {
  sm: { width: 16, height: 16 },
  md: { width: 24, height: 24 },
  lg: { width: 32, height: 32 },
}

export function Logo({
  className = "",
  width,
  height,
  symbol: _symbol = false,
  color,
  size,
}: LogoProps) {
  // If size is provided, use size mapping, otherwise use width/height props or defaults
  const dimensions =
    size && sizeMap[size as keyof typeof sizeMap]
      ? sizeMap[size as keyof typeof sizeMap]
      : { width: width ?? 18, height: height ?? 18 }

  // Use the logo file (if symbol variant exists, use it, otherwise fallback to regular logo)
  const logoSrc = "/logo.svg"

  // Handle color variant with className
  const colorClass =
    color === "primary" ? "text-primary" : color === "secondary" ? "text-secondary" : ""

  return (
    <Image
      src={logoSrc}
      width={dimensions.width}
      height={dimensions.height}
      className={cn(className, colorClass)}
      alt="Logo"
    />
  )
}
