import { createMiddlewareSupabase } from "@repo/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

const DEFAULT_APP_URL = "http://app.localhost:3001"

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
    const appUrl = process.env["NEXT_PUBLIC_APP_URL"] || DEFAULT_APP_URL
    return NextResponse.redirect(new URL("/dashboard", appUrl))
  }

  // Capture ?redirect_to on the sign-in/sign-up surfaces into a short-lived
  // HTTP-only cookie. Done here (not in the page server component) because
  // Next.js 16 forbids cookie writes from server components.
  const redirectTo = req.nextUrl.searchParams.get("redirect_to")
  if (redirectTo && isAuthSurface) {
    response.cookies.set("auth.redirect_to", redirectTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      path: "/",
      maxAge: 60 * 10,
    })
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|robots).*)"],
}
