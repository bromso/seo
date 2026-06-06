"use client"
import { getSupabaseEnv } from "@repo/supabase/env"
import { createBrowserClient } from "@supabase/ssr"

type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>

let cached: SupabaseBrowserClient | undefined

export function createBrowserSupabase(): SupabaseBrowserClient {
  if (cached) return cached
  const { url, key } = getSupabaseEnv()
  const domain = process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
  cached = createBrowserClient(url, key, domain ? { cookieOptions: { domain } } : undefined)
  return cached
}
