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
import { type SignUpInput, SignUpSchema } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignUpEmailForm() {
  const form = useForm<SignUpInput>({ resolver: zodResolver(SignUpSchema) })
  const router = useRouter()

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: data.displayName ? { display_name: data.displayName } : undefined,
      },
    })
    if (error) {
      form.setError("email", { message: error.message })
      return
    }
    toast.success("Account created")
    router.push("/onboarding")
    router.refresh()
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Link
        href="/sign-up"
        className="self-start inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary transition-colors duration-75"
      >
        <ArrowLeftMark size={12} />
        Sign-up options
      </Link>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName" className="text-[13px] text-ink-secondary">
          Display name <span className="text-ink-tertiary">(optional)</span>
        </Label>
        <Input
          id="displayName"
          type="text"
          autoComplete="name"
          placeholder="Jane Smith"
          className="h-11 text-[14.5px]"
          {...form.register("displayName")}
        />
        {form.formState.errors.displayName ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.displayName.message}
          </p>
        ) : null}
      </div>

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
          autoComplete="new-password"
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
        {form.formState.isSubmitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
