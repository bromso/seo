"use client"
import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import type { SiteRow } from "@/lib/db-types"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

export function RunAllButton({ ownerId, sites }: { ownerId: string; sites: SiteRow[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  const queue = useQueueAudit(ownerId)
  return (
    <Button
      disabled={pending || sites.length === 0}
      onClick={() => {
        start(async () => {
          let succeeded = 0
          let queued = 0
          let failed = 0
          for (const site of sites) {
            const r = await queue({ siteId: site.id, requestedUrl: site.url })
            if (!r.ok) failed += 1
            else if ("queued" in r) queued += 1
            else succeeded += 1
          }
          if (succeeded > 0) {
            toast.success(`Queued ${succeeded} audit${succeeded === 1 ? "" : "s"}`)
          }
          if (queued > 0) {
            toast(
              `You are offline. ${queued} audit${queued === 1 ? "" : "s"} will run when you're back online.`
            )
          }
          if (failed > 0) {
            toast.error(`${failed} audit${failed === 1 ? "" : "s"} failed.`)
          }
          router.refresh()
        })
      }}
    >
      {pending ? "Queueing…" : `Run audits on all sites (${sites.length})`}
    </Button>
  )
}
