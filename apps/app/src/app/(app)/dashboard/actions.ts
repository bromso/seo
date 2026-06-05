"use server"
import { canonicalUrl } from "@repo/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { MAX_COMPETITORS } from "@/lib/constants"
import { AddCompetitorSchema, RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export type RunAuditResult = { ok: true; runId: string } | { ok: false; error: string }

export async function runAuditAction(input: unknown): Promise<RunAuditResult> {
  const parsed = RunAuditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

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

  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true, runId: data.id as string }
}

export type AddCompetitorResult = { ok: true; siteId: string } | { ok: false; error: string }

export async function addCompetitorAction(input: unknown): Promise<AddCompetitorResult> {
  const parsed = AddCompetitorSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .eq("is_competitor", true)
  if (countError) return { ok: false, error: countError.message }
  if ((count ?? 0) >= MAX_COMPETITORS) {
    return { ok: false, error: `competitor limit reached (${MAX_COMPETITORS})` }
  }

  const normalized = canonicalUrl(parsed.data.url)
  const { data, error } = await supabase
    .from("sites")
    .insert({
      owner_id: user.id,
      url: parsed.data.url,
      normalized_url: normalized,
      ...(parsed.data.label ? { label: parsed.data.label } : {}),
      is_competitor: true,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath("/dashboard")
  return { ok: true, siteId: data.id as string }
}

export type RemoveCompetitorResult = { ok: true } | { ok: false; error: string }

export async function removeCompetitorAction(siteId: unknown): Promise<RemoveCompetitorResult> {
  const parsed = z.uuid().safeParse(siteId)
  if (!parsed.success) return { ok: false, error: "invalid site id" }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { error } = await supabase
    .from("sites")
    .delete()
    .eq("id", parsed.data)
    .eq("is_competitor", true)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true }
}
