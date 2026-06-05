import { notFound } from "next/navigation"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { createServerSupabase } from "@/lib/supabase-server"
import { RunDetailView } from "@/views/run-detail-view"

export const metadata = { title: "Run details" }

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createServerSupabase()

  const { data: run } = await supabase
    .from("audit_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle<AuditRunRow>()
  if (!run) notFound()

  const { data: results } = await supabase
    .from("audit_results")
    .select("*")
    .eq("run_id", runId)
    .order("category")
    .returns<AuditResultRow[]>()

  return <RunDetailView initialRun={run} initialResults={results ?? []} />
}
