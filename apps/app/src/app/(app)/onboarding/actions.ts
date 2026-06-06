"use server"
import { canonicalUrl } from "@repo/db"
import { createServerSupabase } from "@repo/supabase/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { AddSiteSchema } from "@/lib/schemas"

export type AddSiteResult = { ok: false; error: string }

export async function addSiteAction(input: unknown): Promise<AddSiteResult> {
  const parsed = AddSiteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message }
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const normalized = canonicalUrl(parsed.data.url)
  const { error } = await supabase.from("sites").insert({
    owner_id: user.id,
    url: parsed.data.url,
    normalized_url: normalized,
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    is_competitor: false,
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard", "layout")
  redirect("/dashboard")
}
