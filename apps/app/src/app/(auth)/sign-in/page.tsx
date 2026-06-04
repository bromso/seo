import { AuthCard } from "@/components/auth-card"
import { SignInView } from "@/views/sign-in-view"

export const metadata = { title: "Sign in" }

export default function SignInPage() {
  return (
    <AuthCard title="Sign in" description="Welcome back. Sign in to continue.">
      <SignInView />
    </AuthCard>
  )
}
