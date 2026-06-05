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
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Competitors</SheetTitle>
        </SheetHeader>
        <CompetitorDrawerView competitors={competitors} />
      </SheetContent>
    </Sheet>
  )
}
