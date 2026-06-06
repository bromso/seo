import { getSupabaseEnv } from "@repo/supabase/env"
import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"

type SupabaseServerClient = ReturnType<typeof createServerClient>

export function createMiddlewareSupabase(
  req: NextRequest,
  response: NextResponse
): SupabaseServerClient {
  const { url, key } = getSupabaseEnv()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (
        cookiesToSet: {
          name: string
          value: string
          options: Record<string, unknown>
        }[]
      ) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            ...(process.env["AUTH_COOKIE_DOMAIN"]
              ? { domain: process.env["AUTH_COOKIE_DOMAIN"] }
              : {}),
          })
        }
      },
    },
  })
}
