import { redirect } from "next/navigation"
import { TRENDS_WINDOW_DAYS } from "@/lib/constants"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { createServerSupabase } from "@/lib/supabase-server"
import { DashboardView } from "@/views/dashboard-view"

export const metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: sites } = await supabase
    .from("sites")
    .select("id,owner_id,url,normalized_url,label,is_competitor,created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .returns<SiteRow[]>()

  const selfSite = sites?.find((s) => !s.is_competitor)
  if (!selfSite) redirect("/onboarding")

  const { data: latestScores } = await supabase
    .from("latest_scores_per_site")
    .select(
      "site_id,owner_id,url,label,is_competitor,run_id,run_status,run_started_at,category,result_status,score"
    )
    .returns<LatestScoreRow[]>()

  const cutoff = new Date(Date.now() - TRENDS_WINDOW_DAYS * 86_400_000).toISOString()
  const { data: trends } = await supabase
    .from("score_trends")
    .select("site_id,owner_id,label,is_competitor,category,score,measured_at")
    .gte("measured_at", cutoff)
    .returns<ScoreTrendRow[]>()

  return (
    <DashboardView
      ownerId={user.id}
      sites={sites ?? []}
      latestScores={latestScores ?? []}
      trends={trends ?? []}
    />
  )
}
