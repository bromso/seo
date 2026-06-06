import { createServerSupabase } from "@repo/supabase/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { parseAndValidateRedirectTo } from "@/lib/redirect-to"

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

  const store = await cookies()
  const rawRedirect = store.get("auth.redirect_to")?.value
  store.delete("auth.redirect_to")

  const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] || "http://app.lvh.me:3001"
  const allowlist = [APP_URL, "http://app.lvh.me:3001"]
  const validated = parseAndValidateRedirectTo(rawRedirect, allowlist)

  const isNewUser = !countError && (count ?? 0) === 0
  const destination = isNewUser ? `${APP_URL}/onboarding` : (validated ?? `${APP_URL}/dashboard`)

  return NextResponse.redirect(destination)
}
