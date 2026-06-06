import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

type SupabaseServerClient = ReturnType<typeof createServerClient>

export async function createServerSupabase(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies()
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          cookiesToSet: {
            name: string
            value: string
            options: Record<string, unknown>
          }[]
        ) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                ...(process.env["AUTH_COOKIE_DOMAIN"]
                  ? { domain: process.env["AUTH_COOKIE_DOMAIN"] }
                  : {}),
              })
            }
          } catch {
            // RSC context: middleware writes the refresh
          }
        },
      },
    }
  )
}
