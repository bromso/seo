"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { type SignUpInput, SignUpSchema } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignUpView() {
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
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name (optional)</Label>
        <Input id="displayName" type="text" autoComplete="name" {...form.register("displayName")} />
        {form.formState.errors.displayName ? (
          <p className="text-sm text-destructive">{form.formState.errors.displayName.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Creating account…" : "Sign up"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
