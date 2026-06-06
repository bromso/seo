import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"

type SupabaseServerClient = ReturnType<typeof createServerClient>

export function createMiddlewareSupabase(
  req: NextRequest,
  response: NextResponse
): SupabaseServerClient {
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
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
    }
  )
}
