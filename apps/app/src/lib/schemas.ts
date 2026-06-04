import { z } from "zod"

export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export const SignUpSchema = SignInSchema.extend({
  displayName: z.string().min(1).max(80).optional(),
})

export const AddSiteSchema = z.object({
  url: z.url(),
  label: z.string().max(80).optional(),
})

export const RunAuditSchema = z.object({
  siteId: z.uuid(),
  requestedUrl: z.url(),
})

export type SignInInput = z.infer<typeof SignInSchema>
export type SignUpInput = z.infer<typeof SignUpSchema>
export type AddSiteInput = z.infer<typeof AddSiteSchema>
export type RunAuditInput = z.infer<typeof RunAuditSchema>
