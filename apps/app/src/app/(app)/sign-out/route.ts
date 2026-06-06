import { createServerSupabase } from "@repo/supabase/server"
import { NextResponse } from "next/server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const authUrl = process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://auth.localhost:3002"
  return NextResponse.redirect(new URL("/sign-in", authUrl), 303)
}
