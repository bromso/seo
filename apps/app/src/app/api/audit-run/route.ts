import { NextResponse } from "next/server"
import { z } from "zod"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = RunAuditSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const rawKey = req.headers.get("idempotency-key")
  const idempotencyKey = rawKey === null || rawKey === "" ? null : rawKey
  if (idempotencyKey !== null && !z.uuid().safeParse(idempotencyKey).success) {
    return NextResponse.json({ ok: false, error: "invalid idempotency key" }, { status: 400 })
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
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505" && idempotencyKey !== null) {
      const { data: existing } = await supabase
        .from("audit_runs")
        .select("id")
        .eq("owner_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, runId: existing.id as string })
      }
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, runId: data.id as string })
}
