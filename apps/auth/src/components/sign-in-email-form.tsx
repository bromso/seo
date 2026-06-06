"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { createBrowserSupabase } from "@repo/supabase/browser"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { ArrowLeftMark } from "@/components/provider-icons"
import { type SignInInput, SignInSchema } from "@/lib/schemas"

export function SignInEmailForm() {
  const form = useForm<SignInInput>({ resolver: zodResolver(SignInSchema) })

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword(data)
    if (error) {
      form.setError("password", { message: error.message })
      return
    }
    toast.success("Signed in")
    // Cross-origin: this form runs on auth.localhost, the app lives on
    // app.localhost. router.push would resolve relatively. Hard-navigate to
    // the configured app URL so the .brand.com session cookie flows over.
    const appUrl = process.env["NEXT_PUBLIC_APP_URL"] || "http://app.lvh.me:3001"
    window.location.assign(`${appUrl}/dashboard`)
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Link
        href="/sign-in"
        className="self-start inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary transition-colors duration-75"
      >
        <ArrowLeftMark size={12} />
        Login options
      </Link>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-[13px] text-ink-secondary">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-11 text-[14.5px]"
          {...form.register("email")}
        />
        {form.formState.errors.email ? (
          <p className="text-[12px] text-status-failure">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-[13px] text-ink-secondary">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          className="h-11 text-[14.5px]"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full bg-brand-accent text-brand-accent-ink hover:brightness-105 disabled:opacity-60"
      >
        {form.formState.isSubmitting ? "Signing in…" : "Continue"}
      </Button>
    </form>
  )
}
