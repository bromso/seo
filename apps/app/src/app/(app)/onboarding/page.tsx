import { redirect } from "next/navigation"
import { createServerSupabase } from "@/lib/supabase-server"
import { OnboardingView } from "@/views/onboarding-view"

export const metadata = { title: "Onboarding" }

export default async function OnboardingPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()
  if (site) redirect("/dashboard")

  return <OnboardingView />
}
