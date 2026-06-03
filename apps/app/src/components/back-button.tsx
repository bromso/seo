"use client"

import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import type { ComponentProps } from "react"

type ButtonProps = ComponentProps<typeof Button>

export function BackButton({ variant = "outline", children = "Go Back", ...props }: ButtonProps) {
  const router = useRouter()
  return (
    <Button variant={variant} onClick={() => router.back()} {...props}>
      {children}
    </Button>
  )
}
