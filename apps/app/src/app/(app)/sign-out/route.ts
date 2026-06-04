import { NextResponse } from "next/server"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
  return NextResponse.redirect(new URL("/sign-in", appUrl))
}
