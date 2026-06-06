import Link from "next/link"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
  PasskeyMark,
} from "@/components/provider-icons"

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
      <div className="flex flex-col gap-2.5">
        {/* OAuth provider forms get added in Task 11. Placeholders preserve layout. */}
        <AuthProviderButton tone="primary" label="Continue with Google" icon={<GoogleMark />} />
        <AuthProviderButton label="Continue with Apple" icon={<AppleMark />} />
        <AuthProviderButton label="Continue with Microsoft" icon={<MicrosoftMark />} />
        <AuthProviderButton label="Continue with GitHub" icon={<GitHubMark />} />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton href="/sign-in/email" label="Continue with email" icon={<MailMark />} />
        <AuthProviderButton label="Sign in with a passkey" icon={<PasskeyMark />} />
      </div>
      <AuthErrorToast />
    </AuthShell>
  )
}
