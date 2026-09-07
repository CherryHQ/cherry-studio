import * as z from 'zod'

export const BrowserImportSourceSchema = z.object({
  id: z.string(),
  browser: z.enum(['chrome', 'edge', 'brave', 'firefox', 'dia', 'comet', 'vivaldi', 'opera', 'chromium']),
  profile: z.string(),
  displayName: z.string().optional(),
  account: z.string().optional(),
  history: z.boolean(),
  cookies: z.enum(['supported', 'requires_authorization', 'unavailable'])
})
export type BrowserImportSource = z.infer<typeof BrowserImportSourceSchema>
export const BrowserImportOptionsSchema = z
  .strictObject({
    sourceId: z.string().optional(),
    history: z.boolean(),
    cookies: z.boolean(),
    localStorage: z.boolean(),
    domains: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.:[\]-]+$/)
      )
      .max(100)
  })
  .refine((v) => v.history || v.cookies || v.localStorage, 'Select at least one category')
export type BrowserImportOptions = z.infer<typeof BrowserImportOptionsSchema>
export const BrowserImportReasonSchema = z.enum([
  'expired',
  'partitioned',
  'app_bound',
  'unsupported_encryption',
  'key_unavailable',
  'key_store_unavailable',
  'access_denied',
  'decryption_failed',
  'source_unavailable'
])
export type BrowserImportReason = z.infer<typeof BrowserImportReasonSchema>
const CategoryResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  failed: z.number(),
  unsupported: z.boolean(),
  reasons: z.partialRecord(BrowserImportReasonSchema, z.number().int().positive()).optional()
})
export const BrowserImportResultSchema = z.object({
  cancelled: z.boolean(),
  history: CategoryResultSchema,
  cookies: CategoryResultSchema,
  localStorage: CategoryResultSchema
})
export type BrowserImportResult = z.infer<typeof BrowserImportResultSchema>
