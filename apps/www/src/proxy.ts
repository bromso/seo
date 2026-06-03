import { type NextRequest, NextResponse } from "next/server"

export function proxy(_request: NextRequest) {
  const response = NextResponse.next()

  // Content Security Policy
  // Using strict CSP with nonce would require changes to inline scripts
  // For now, using a production-ready CSP that works with Next.js
  const cspDirectives = [
    "default-src 'self'",
    // Allow scripts from self, Next.js inline scripts, and external CDNs for icons
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Allow styles from self and inline styles (required for Next.js)
    "style-src 'self' 'unsafe-inline'",
    // Allow images from self, data URIs, and blob URLs
    "img-src 'self' data: blob: https:",
    // Allow fonts from self
    "font-src 'self' data:",
    // Allow connections to self and API endpoints
    "connect-src 'self' https://api.iconify.design",
    // Prevent embedding in frames (clickjacking protection)
    "frame-ancestors 'none'",
    // Only allow forms to submit to self
    "form-action 'self'",
    // Restrict base URI to self
    "base-uri 'self'",
    // Block all object/embed/applet
    "object-src 'none'",
    // Upgrade HTTP to HTTPS
    "upgrade-insecure-requests",
  ].join("; ")

  response.headers.set("Content-Security-Policy", cspDirectives)

  // HTTP Strict Transport Security (HSTS)
  // max-age=2 years, include subdomains, eligible for preload list
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")

  // Cross-Origin-Opener-Policy (COOP)
  // Prevents cross-origin documents from opening this window
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")

  // Cross-Origin-Embedder-Policy (COEP)
  // Allows loading cross-origin resources that don't explicitly grant permission
  response.headers.set("Cross-Origin-Embedder-Policy", "credentialless")

  // X-Frame-Options (legacy, but still useful for older browsers)
  // CSP frame-ancestors provides the same protection
  response.headers.set("X-Frame-Options", "DENY")

  // X-Content-Type-Options
  // Prevents MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff")

  // Referrer-Policy
  // Controls how much referrer information is sent
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

  // Permissions-Policy (formerly Feature-Policy)
  // Restricts browser features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  )

  return response
}

export const config = {
  // Match all paths except static files and API routes that might need different headers
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
}
