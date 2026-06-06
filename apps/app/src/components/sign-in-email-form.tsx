"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { ArrowLeftMark } from "@/components/provider-icons"
import { type SignInInput, SignInSchema } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignInEmailForm() {
  const form = useForm<SignInInput>({ resolver: zodResolver(SignInSchema) })
  const router = useRouter()

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword(data)
    if (error) {
      form.setError("password", { message: error.message })
      return
    }
    toast.success("Signed in")
    router.push("/dashboard")
    router.refresh()
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
