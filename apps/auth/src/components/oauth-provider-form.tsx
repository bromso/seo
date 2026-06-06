import type { ReactNode } from "react"
import { type OAuthProvider, startOAuthAction } from "@/app/auth/start/actions"
import { AuthProviderButton } from "@/components/auth-provider-button"

type Props = {
  provider: OAuthProvider
  label: string
  icon: ReactNode
  tone?: "primary" | "metal"
}

export function OAuthProviderForm({ provider, label, icon, tone }: Props) {
  const action = startOAuthAction.bind(null, provider)
  return (
    <form action={action}>
      <AuthProviderButton type="submit" tone={tone} label={label} icon={icon} />
    </form>
  )
}
