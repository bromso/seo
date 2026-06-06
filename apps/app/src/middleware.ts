import { type CookieOptions, createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => {
          for (const c of cookies) {
            response.cookies.set(c.name, c.value, c.options)
          }
        },
      },
    }
  )

  // Refresh the session cookie if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthRoute =
    path === "/sign-in" ||
    path === "/sign-up" ||
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/") ||
    path.startsWith("/auth/")
  const isPublicRoute = path === "/" || path.startsWith("/_next/") || path.startsWith("/favicon")

  if (!user && !isAuthRoute && !isPublicRoute) {
    return NextResponse.redirect(new URL("/sign-in", req.url))
  }
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw\\.js).*)"],
}
