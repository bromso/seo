"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { addSiteAction } from "@/app/(app)/onboarding/actions"
import { type AddSiteInput, AddSiteSchema } from "@/lib/schemas"

export function OnboardingView() {
  const form = useForm<AddSiteInput>({ resolver: zodResolver(AddSiteSchema) })
  const [pending, setPending] = useState(false)

  const onSubmit = form.handleSubmit(async (data) => {
    setPending(true)
    // addSiteAction redirects on success — that navigation handles the success branch
    const result = await addSiteAction(data)
    // Only reached when the action returned an error (no redirect)
    setPending(false)
    toast.error(result.error)
  })

  return (
    <main className="container mx-auto max-w-md py-12">
      <h1 className="mb-2 text-2xl font-semibold">Add your site</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter the URL of the site you want to track. You can add competitors later.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Site URL</Label>
          <Input id="url" type="url" placeholder="https://example.com" {...form.register("url")} />
          {form.formState.errors.url ? (
            <p className="text-sm text-destructive">{form.formState.errors.url.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" type="text" placeholder="My site" {...form.register("label")} />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Adding…" : "Add site"}
        </Button>
      </form>
    </main>
  )
}
