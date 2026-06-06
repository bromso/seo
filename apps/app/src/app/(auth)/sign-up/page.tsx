import Link from "next/link"
import { Suspense } from "react"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import { OAuthProviderForm } from "@/components/oauth-provider-form"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
} from "@/components/provider-icons"

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
      <div className="flex flex-col gap-2.5">
        <OAuthProviderForm
          provider="google"
          tone="primary"
          label="Sign up with Google"
          icon={<GoogleMark />}
        />
        <AuthProviderButton label="Sign up with Apple" icon={<AppleMark />} />
        <OAuthProviderForm
          provider="azure"
          label="Sign up with Microsoft"
          icon={<MicrosoftMark />}
        />
        <OAuthProviderForm provider="github" label="Sign up with GitHub" icon={<GitHubMark />} />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton href="/sign-up/email" label="Sign up with email" icon={<MailMark />} />
      </div>
      <Suspense fallback={null}>
        <AuthErrorToast />
      </Suspense>
    </AuthShell>
  )
}
