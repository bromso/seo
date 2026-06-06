"use server"
import { createServerSupabase } from "@repo/supabase/server"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export type OAuthProvider = "google" | "azure" | "github"

export async function startOAuthAction(provider: OAuthProvider) {
  const supabase = await createServerSupabase()
  const origin = (await headers()).get("origin") ?? "http://auth.lvh.me:3002"

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: provider === "github" ? "read:user user:email" : undefined,
    },
  })

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`)
  }
  if (!data?.url) {
    redirect("/sign-in?error=oauth_unavailable")
  }
  redirect(data.url)
}
