/** Inline brand marks for the auth provider buttons. Multi-color for the
 *  brands' marks (Google/Microsoft), monochrome for Apple/Mail/Passkey so
 *  they pick up the surrounding ink color. */

export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden role="img">
      <title>Google</title>
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}

export function AppleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="currentColor" aria-hidden role="img">
      <title>Apple</title>
      <path d="M13.31 9.55c-.02-2.04 1.67-3.02 1.74-3.07-.95-1.38-2.42-1.57-2.95-1.6-1.26-.13-2.45.74-3.08.74-.65 0-1.62-.72-2.66-.7-1.37.02-2.63.79-3.34 2.02-1.42 2.46-.36 6.1 1.03 8.1.68.98 1.49 2.08 2.55 2.04 1.02-.04 1.41-.66 2.65-.66 1.23 0 1.59.66 2.67.64 1.1-.02 1.8-1 2.47-1.99.78-1.14 1.1-2.25 1.12-2.3-.02-.01-2.16-.83-2.2-3.22zM11.27 3.6c.56-.69.94-1.64.84-2.6-.81.03-1.8.55-2.38 1.23-.52.6-.98 1.57-.86 2.5.91.07 1.83-.45 2.4-1.13z" />
    </svg>
  )
}

export function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden role="img">
      <title>Microsoft</title>
      <rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
      <rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
      <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
      <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
    </svg>
  )
}

export function MailMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      role="img"
    >
      <title>Email</title>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6 8.5-6" />
    </svg>
  )
}

export function PasskeyMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      role="img"
    >
      <title>Passkey</title>
      <circle cx="9" cy="9" r="3.25" />
      <path d="M14.5 9h6.5" />
      <path d="M19 9v3" />
      <path d="M17 9v2" />
    </svg>
  )
}

export function ArrowLeftMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      role="img"
    >
      <title>Back</title>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  )
}
