import { createServerSupabase } from "@repo/supabase/server"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/app-shell"

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
    <AppShell ownerId={user.id} email={user.email ?? ""} siteLabel={site?.label ?? null}>
      {children}
    </AppShell>
  )
}
