import { AbsolutePathSchema } from '@shared/data/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

export const OfficePreviewExtensionSchema = z.enum(['docx', 'xlsx', 'pptx'])
export type OfficePreviewExtension = z.infer<typeof OfficePreviewExtensionSchema>

const OfficePreviewRenderInputSchema = z
  .object({
    workspacePath: AbsolutePathSchema,
    requestId: z.string().trim().min(1).max(128),
    filePath: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes('\0'), 'filePath must not contain null bytes')
  })
  .strict()

const OfficePreviewCancelInputSchema = z
  .object({
    requestId: z.string().trim().min(1).max(128)
  })
  .strict()

const OfficePreviewRenderResultSchema = z.object({ html: z.string() }).strict()
const OfficePreviewCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export const officePreviewRequestSchemas = {
  'office_preview.render': defineRoute({
    input: OfficePreviewRenderInputSchema,
    output: OfficePreviewRenderResultSchema
  }),
  'office_preview.cancel': defineRoute({
    input: OfficePreviewCancelInputSchema,
    output: OfficePreviewCancelResultSchema
  })
}

export type OfficePreviewRenderInput = z.infer<typeof OfficePreviewRenderInputSchema>
export type OfficePreviewRenderResult = z.infer<typeof OfficePreviewRenderResultSchema>
export type OfficePreviewCancelInput = z.infer<typeof OfficePreviewCancelInputSchema>
export type OfficePreviewCancelResult = z.infer<typeof OfficePreviewCancelResultSchema>
