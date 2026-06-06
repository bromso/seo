import { createServerSupabase } from "@repo/supabase/server"
import { NextResponse } from "next/server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
  return NextResponse.redirect(new URL("/sign-in", appUrl))
}
