import { createMiddlewareSupabase } from "@repo/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })

  const supabase = createMiddlewareSupabase(req, response)

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
