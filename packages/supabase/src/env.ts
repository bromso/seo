/**
 * Dev-only Supabase env fallbacks.
 *
 * If a developer hasn't set `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` (e.g., on a fresh clone), this helper
 * returns the deterministic values shipped by the Supabase CLI's local
 * stack so `supabase start` + `bun dev` works with zero env setup.
 *
 * In production (`NODE_ENV === "production"`) the helper throws when env
 * is missing, so we never accidentally ship the local key.
 *
 * The local anon key is a public, well-known JWT documented in the
 * Supabase CLI tutorials. It only authenticates against a Supabase
 * instance running on the developer's own machine.
 */

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321"
const LOCAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

export function getSupabaseEnv(): { url: string; key: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"]
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  if (url && key) return { url, key }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in production"
    )
  }
  return { url: LOCAL_SUPABASE_URL, key: LOCAL_SUPABASE_ANON_KEY }
}
