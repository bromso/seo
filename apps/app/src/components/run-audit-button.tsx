"use client"
import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { runAuditAction } from "@/app/(app)/dashboard/actions"

export function RunAuditButton({ siteId, url }: { siteId: string; url: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <Button
      disabled={pending}
      onClick={() => {
        start(async () => {
          const result = await runAuditAction({ siteId, requestedUrl: url })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
          router.push(`/dashboard/runs/${result.runId}`)
        })
      }}
    >
      {pending ? "Queueing…" : "Run new audit"}
    </Button>
  )
}
