"use client"

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-bold">You're offline</h1>
        <p className="mt-2 text-muted-foreground">
          Some features may be unavailable. Your changes will sync when you're back online.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}
