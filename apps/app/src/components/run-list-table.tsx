"use client"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table"
import Link from "next/link"
import { RunStatusBadge } from "@/components/run-status-badge"
import type { AuditRunRow } from "@/lib/db-types"
import { formatRelativeTime } from "@/lib/format"

export function RunListTable({ runs }: { runs: AuditRunRow[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No runs yet. Click "Run new audit" to start.</p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>URL</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>{formatRelativeTime(run.started_at)}</TableCell>
            <TableCell>
              <RunStatusBadge status={run.status} />
            </TableCell>
            <TableCell className="max-w-xs truncate text-sm">{run.requested_url}</TableCell>
            <TableCell className="text-right">
              <Link href={`/dashboard/runs/${run.id}`} className="text-sm underline">
                Open
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
