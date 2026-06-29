import { AbsolutePathSchema } from '@shared/data/types/file'
import * as z from 'zod'

import { defineRoute } from '../define'

export const OfficePreviewExtensionSchema = z.enum(['docx', 'xlsx', 'pptx'])
export type OfficePreviewExtension = z.infer<typeof OfficePreviewExtensionSchema>

export const OfficePreviewTypeSchema = z.enum(['html', 'excel'])
export type OfficePreviewType = z.infer<typeof OfficePreviewTypeSchema>

export const OfficePreviewErrorCodeSchema = z.enum([
  'invalid_request',
  'unsupported_extension',
  'file_unavailable',
  'file_too_large',
  'parse_timeout',
  'parse_failed'
])
export type OfficePreviewErrorCode = z.infer<typeof OfficePreviewErrorCodeSchema>

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

const OfficePreviewRenderResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      extension: OfficePreviewExtensionSchema,
      type: OfficePreviewTypeSchema,
      html: z.string()
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      code: OfficePreviewErrorCodeSchema,
      extension: OfficePreviewExtensionSchema.optional(),
      type: OfficePreviewTypeSchema.optional()
    })
    .strict()
])

export const officePreviewRequestSchemas = {
  'office_preview.render': defineRoute({
    input: OfficePreviewRenderInputSchema,
    output: OfficePreviewRenderResultSchema
  })
}

export type OfficePreviewRenderInput = z.infer<typeof OfficePreviewRenderInputSchema>
export type OfficePreviewRenderResult = z.infer<typeof OfficePreviewRenderResultSchema>
