"use client"
import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { runAuditAllAction } from "@/app/(app)/dashboard/actions"

export function RunAllButton({ siteCount }: { siteCount: number }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <Button
      disabled={pending || siteCount === 0}
      onClick={() => {
        start(async () => {
          const result = await runAuditAllAction()
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(`Queued ${result.runIds.length} audits`)
          router.refresh()
        })
      }}
    >
      {pending ? "Queueing…" : `Run audits on all sites (${siteCount})`}
    </Button>
  )
}
