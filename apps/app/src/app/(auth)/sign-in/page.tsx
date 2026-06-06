import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { SignInView } from "@/views/sign-in-view"

export const metadata = { title: "Log in" }

export default function SignInPage() {
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
      <SignInView />
    </AuthShell>
  )
}
