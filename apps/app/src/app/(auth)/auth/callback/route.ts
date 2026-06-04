import { NextResponse } from "next/server"

export function GET() {
  return new NextResponse("OAuth callback not implemented yet", { status: 501 })
}
