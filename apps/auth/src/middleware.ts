import { createMiddlewareSupabase } from "@repo/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })
  const supabase = createMiddlewareSupabase(req, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthSurface =
    path === "/sign-in" ||
    path === "/sign-up" ||
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/")

  if (user && isAuthSurface) {
    const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
    return NextResponse.redirect(new URL("/dashboard", appUrl))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|robots).*)"],
}
