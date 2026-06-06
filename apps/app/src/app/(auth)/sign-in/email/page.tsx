import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { SignInEmailForm } from "@/components/sign-in-email-form"

export const metadata = { title: "Log in" }

export default function SignInEmailPage() {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          Don't have an account?{" "}
          <Link
            href="/sign-up"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      <SignInEmailForm />
    </AuthShell>
  )
}
