import * as z from 'zod'

import { defineRoute } from '../define'

export const OfficePreviewExtensionSchema = z.enum(['xlsx'])
export type OfficePreviewExtension = z.infer<typeof OfficePreviewExtensionSchema>

const OfficePreviewRenderInputSchema = z
  .object({
    workspacePath: z.string().trim().min(1),
    filePath: z.string().trim().min(1)
  })
  .strict()

const UniverWorkbookSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    appVersion: z.string().min(1),
    locale: z.string().min(1),
    styles: z.record(z.string(), z.unknown().nullable()),
    sheetOrder: z.array(z.string().min(1)),
    sheets: z.record(z.string(), z.unknown())
  })
  .passthrough()

const OfficePreviewRenderResultSchema = z
  .object({
    kind: z.literal('sheet'),
    workbook: UniverWorkbookSnapshotSchema
  })
  .strict()

export const officePreviewRequestSchemas = {
  'office_preview.render': defineRoute({
    input: OfficePreviewRenderInputSchema,
    output: OfficePreviewRenderResultSchema
  })
}

export type OfficePreviewRenderInput = z.infer<typeof OfficePreviewRenderInputSchema>
export type OfficePreviewRenderResult = z.infer<typeof OfficePreviewRenderResultSchema>
export type UniverWorkbookSnapshot = z.infer<typeof UniverWorkbookSnapshotSchema>
