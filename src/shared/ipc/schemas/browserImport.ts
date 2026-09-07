import * as z from 'zod'

export const BrowserImportSourceSchema = z.object({
  id: z.string(),
  browser: z.enum(['chrome', 'edge', 'brave', 'firefox']),
  profile: z.string(),
  history: z.boolean(),
  cookies: z.enum(['supported', 'unencrypted_only', 'unavailable'])
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
const CategoryResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  failed: z.number(),
  unsupported: z.boolean()
})
export const BrowserImportResultSchema = z.object({
  cancelled: z.boolean(),
  history: CategoryResultSchema,
  cookies: CategoryResultSchema,
  localStorage: CategoryResultSchema
})
export type BrowserImportResult = z.infer<typeof BrowserImportResultSchema>
