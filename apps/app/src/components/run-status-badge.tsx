import { Badge } from "@repo/ui/components/badge"
import { type RunStatus, statusBadgeVariant } from "@/lib/format"

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
}
