import { NextResponse } from "next/server"
import { createServerSupabase } from "@/lib/supabase-server"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const errorParam = url.searchParams.get("error")

  if (errorParam) {
    return NextResponse.redirect(new URL(`/sign-in?error=${errorParam}`, url))
  }
  if (!code) {
    return NextResponse.redirect(new URL("/sign-in?error=missing_code", url))
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, url)
    )
  }

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })

  // Default to /dashboard on count-query failure so the user isn't stuck.
  const destination = !countError && (count ?? 0) === 0 ? "/onboarding" : "/dashboard"
  return NextResponse.redirect(new URL(destination, url))
}
