import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/app-shell"
import { createServerSupabase } from "@/lib/supabase-server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("label")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()

  return (
    <AppShell email={user.email ?? ""} siteLabel={site?.label ?? null}>
      {children}
    </AppShell>
  )
}
