import { createMiddlewareSupabase } from "@repo/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })

  const supabase = createMiddlewareSupabase(req, response)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isPublicRoute =
    path === "/" ||
    path === "/sign-out" ||
    path.startsWith("/_next/") ||
    path.startsWith("/favicon")

  if (!user && !isPublicRoute) {
    const authUrl = process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://auth.localhost:3002"
    const target = new URL("/sign-in", authUrl)
    target.searchParams.set("redirect_to", req.nextUrl.href)
    return NextResponse.redirect(target)
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw\\.js).*)"],
}
