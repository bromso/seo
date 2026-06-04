import { redirect } from "next/navigation"
import type { AuditRunRow, SiteRow } from "@/lib/db-types"
import { createServerSupabase } from "@/lib/supabase-server"
import { DashboardView } from "@/views/dashboard-view"

export const metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("id,owner_id,url,normalized_url,label,is_competitor,created_at")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle<SiteRow>()

  if (!site) redirect("/onboarding")

  const { data: runs } = await supabase
    .from("audit_runs")
    .select(
      "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by"
    )
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<AuditRunRow[]>()

  return <DashboardView site={site} initialRuns={runs ?? []} />
}
