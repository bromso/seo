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

export const AddCompetitorSchema = z.object({
  url: z.url(),
  label: z.string().max(80).optional(),
})

export const UpdateCompetitorSchema = z.object({
  siteId: z.uuid(),
  label: z.string().max(80).nullable(),
})

export const RemoveCompetitorsSchema = z.object({
  siteIds: z.array(z.uuid()).min(1).max(50),
})

export type SignInInput = z.infer<typeof SignInSchema>
export type SignUpInput = z.infer<typeof SignUpSchema>
export type AddSiteInput = z.infer<typeof AddSiteSchema>
export type RunAuditInput = z.infer<typeof RunAuditSchema>
export type AddCompetitorInput = z.infer<typeof AddCompetitorSchema>
export type UpdateCompetitorInput = z.infer<typeof UpdateCompetitorSchema>
export type RemoveCompetitorsInput = z.infer<typeof RemoveCompetitorsSchema>
