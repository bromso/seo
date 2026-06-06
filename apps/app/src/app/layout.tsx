import { Toaster } from "@repo/ui/components/sonner"
import "@repo/ui/globals.css"
import "./globals.css"
import type { Metadata, Viewport } from "next"
import { Figtree } from "next/font/google"
import type { ReactElement, ReactNode } from "react"
import { WebVitals } from "@/components/web-vitals"
import { Providers } from "./providers"

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-sans",
  display: "swap",
  preload: true,
})

export const metadata: Metadata = {
  title: {
    default: "Boilerplate App",
    template: "%s | Boilerplate",
  },
  description: "Application shell — frontend boilerplate",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "App",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>): ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preconnect to external resources for faster loading */}
        <link rel="preconnect" href="https://api.iconify.design" />
        <link rel="dns-prefetch" href="https://api.iconify.design" />
      </head>
      <body className={`${figtree.className} group/body antialiased`}>
        <WebVitals />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  )
}
