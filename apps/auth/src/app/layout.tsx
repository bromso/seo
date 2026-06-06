import "@/app/globals.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  title: { default: "Sign in", template: "%s · brand auth" },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  )
}
