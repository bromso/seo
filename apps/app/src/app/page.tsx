import { createServerSupabase } from "@repo/supabase/server"
import { redirect } from "next/navigation"

export default async function RootPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  redirect(user ? "/dashboard" : "/sign-in")
}
