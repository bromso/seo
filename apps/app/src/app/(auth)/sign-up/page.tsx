import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { SignUpView } from "@/views/sign-up-view"

export const metadata = { title: "Sign up" }

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start auditing in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Log in
          </Link>
        </>
      }
    >
      <SignUpView />
    </AuthShell>
  )
}
