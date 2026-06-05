import { NextResponse } from "next/server"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = RunAuditSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("audit_runs")
    .insert({
      site_id: parsed.data.siteId,
      owner_id: user.id,
      requested_url: parsed.data.requestedUrl,
      triggered_by: "manual",
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, runId: data.id as string })
}
