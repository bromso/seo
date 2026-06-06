"use client"
import { createBrowserClient } from "@supabase/ssr"

let cached: ReturnType<typeof createBrowserClient> | undefined

export function createBrowserSupabase() {
  if (cached) return cached
  const domain = process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
  cached = createBrowserClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    domain ? { cookieOptions: { domain } } : undefined
  )
  return cached
}
