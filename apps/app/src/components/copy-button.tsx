"use client"

import { Icon } from "@iconify/react"
import { Button } from "@repo/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import type { ComponentProps } from "react"
import { useState } from "react"

interface Props extends ComponentProps<typeof Button> {
  text: string
}

export function CopyButton({ text, className, ...rest }: Props) {
  const [isCopied, setIsCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to copy text: ", err)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={className}
            onClick={copyToClipboard}
            aria-label={isCopied ? "Copied" : "Copy to clipboard"}
            {...rest}
          >
            {isCopied ? (
              <Icon icon="mdi:check" className="m-auto" />
            ) : (
              <Icon icon="mdi:content-copy" className="m-auto" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isCopied ? "Copied!" : "Copy"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
