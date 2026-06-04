import { z } from "zod"

export const CategorySchema = z.enum(["performance", "seo", "best-practices", "pwa", "on-page"])

export const SeveritySchema = z.enum(["info", "warn", "error"])

export const ErrorCodeSchema = z.enum([
  "DNS_ERROR",
  "HTTP_4XX",
  "HTTP_5XX",
  "TIMEOUT",
  "ABORTED",
  "LIGHTHOUSE_CRASH",
  "LIGHTHOUSE_NO_FCP",
  "INVALID_HTML",
  "UNKNOWN",
])

export const IssueOccurrenceSchema = z.object({
  selector: z.string().optional(),
  snippet: z.string().max(200).optional(),
  url: z.url().optional(),
})

export const IssueSchema = z.object({
  rule: z.string().min(1),
  severity: SeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  recommendation: z.string().min(1),
  count: z.number().int().min(1),
  occurrences: z.array(IssueOccurrenceSchema).max(5),
  docsUrl: z.url().optional(),
})

const BaseSchema = z.object({
  category: CategorySchema,
  url: z.string().min(1),
  requestedUrl: z.string().min(1),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().min(0),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1),
})

const ScoreSchema = z.number().int().min(0).max(100)

const SuccessSchema = BaseSchema.extend({
  status: z.literal("success"),
  score: ScoreSchema,
  issues: z.array(IssueSchema),
  raw: z.unknown(),
})

const PartialSchema = BaseSchema.extend({
  status: z.literal("partial"),
  score: ScoreSchema,
  issues: z.array(IssueSchema),
  raw: z.unknown(),
  partialReasons: z.array(z.string().min(1)).min(1),
})

const FailureSchema = BaseSchema.extend({
  status: z.literal("failed"),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
})

export const AuditResultSchema = z.discriminatedUnion("status", [
  SuccessSchema,
  PartialSchema,
  FailureSchema,
])
