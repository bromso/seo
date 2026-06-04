import { AuthCard } from "@/components/auth-card"
import { SignUpView } from "@/views/sign-up-view"

export const metadata = { title: "Sign up" }

export default function SignUpPage() {
  return (
    <AuthCard title="Sign up" description="Create your account to get started.">
      <SignUpView />
    </AuthCard>
  )
}
