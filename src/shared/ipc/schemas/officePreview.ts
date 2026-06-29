import { AbsolutePathSchema } from '@shared/data/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

export const OfficePreviewExtensionSchema = z.enum(['docx', 'xlsx', 'pptx'])
export type OfficePreviewExtension = z.infer<typeof OfficePreviewExtensionSchema>

const OfficePreviewRenderInputSchema = z
  .object({
    workspacePath: AbsolutePathSchema,
    filePath: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes('\0'), 'filePath must not contain null bytes')
  })
  .strict()

const OfficePreviewRenderResultSchema = z.object({ html: z.string() }).strict()

export const officePreviewRequestSchemas = {
  'office_preview.render': defineRoute({
    input: OfficePreviewRenderInputSchema,
    output: OfficePreviewRenderResultSchema
  })
}

export type OfficePreviewRenderInput = z.infer<typeof OfficePreviewRenderInputSchema>
export type OfficePreviewRenderResult = z.infer<typeof OfficePreviewRenderResultSchema>
