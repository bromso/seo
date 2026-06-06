"use client"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog"
import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import { isDismissed, markDismissed } from "@/lib/pwa/install-state"
import { isIosSafari, isStandalone } from "@/lib/pwa/platform"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

export function InstallButton(): ReactElement | null {
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosDialog, setShowIosDialog] = useState(false)
  const [iosCapable, setIosCapable] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setInstalled(isStandalone())
    setDismissed(isDismissed())
    setIosCapable(isIosSafari())

    const onBefore = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", onBefore)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (!mounted) return null
  if (installed || dismissed) return null

  if (deferredPrompt) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await deferredPrompt.prompt()
          const { outcome } = await deferredPrompt.userChoice
          setDeferredPrompt(null)
          if (outcome === "dismissed") {
            markDismissed()
            setDismissed(true)
          }
        }}
      >
        Install
      </Button>
    )
  }

  if (iosCapable) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setShowIosDialog(true)}>
          Install
        </Button>
        <Dialog open={showIosDialog} onOpenChange={setShowIosDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Install this app</DialogTitle>
              <DialogDescription>
                Add SEO Audit to your home screen for a faster, app-like experience.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-2 text-sm">
              <li>
                1. Tap the <strong>Share</strong> icon in Safari's toolbar.
              </li>
              <li>
                2. Scroll and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                3. Tap <strong>Add</strong> in the top-right corner.
              </li>
            </ol>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowIosDialog(false)}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  markDismissed()
                  setDismissed(true)
                  setShowIosDialog(false)
                }}
              >
                Don't show again
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return null
}
