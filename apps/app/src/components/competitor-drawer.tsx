"use client"
import { Button } from "@repo/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet"
import { MAX_COMPETITORS } from "@/lib/constants"
import type { SiteRow } from "@/lib/db-types"
import { CompetitorDrawerView } from "@/views/competitor-drawer-view"

export function CompetitorDrawer({ competitors }: { competitors: SiteRow[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          Manage competitors ({competitors.length}/{MAX_COMPETITORS})
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-center gap-2.5">
            <SheetTitle className="text-[16px] font-semibold text-ink-primary">
              Competitors
            </SheetTitle>
            <span className="num inline-flex h-5 items-center rounded-full border border-border-subtle px-2 text-[11px] font-medium text-ink-secondary tabular-nums">
              {competitors.length} of {MAX_COMPETITORS}
            </span>
          </div>
        </SheetHeader>
        <CompetitorDrawerView competitors={competitors} />
      </SheetContent>
    </Sheet>
  )
}
