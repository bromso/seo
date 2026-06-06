"use server"
import { canonicalUrl } from "@repo/db"
import { createServerSupabase } from "@repo/supabase/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { MAX_COMPETITORS } from "@/lib/constants"
import { AddCompetitorSchema, RemoveCompetitorsSchema, UpdateCompetitorSchema } from "@/lib/schemas"

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

export type RemoveCompetitorsResult = { ok: true; removed: number } | { ok: false; error: string }

export async function removeCompetitorsAction(input: unknown): Promise<RemoveCompetitorsResult> {
  const parsed = RemoveCompetitorsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { error, count } = await supabase
    .from("sites")
    .delete({ count: "exact" })
    .in("id", parsed.data.siteIds)
    .eq("is_competitor", true)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true, removed: count ?? 0 }
}

export type UpdateCompetitorResult = { ok: true } | { ok: false; error: string }

export async function updateCompetitorAction(input: unknown): Promise<UpdateCompetitorResult> {
  const parsed = UpdateCompetitorSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const nextLabel = parsed.data.label?.trim() || null
  const { error } = await supabase
    .from("sites")
    .update({ label: nextLabel })
    .eq("id", parsed.data.siteId)
    .eq("is_competitor", true)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true }
}
