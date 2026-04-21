import type { FileMetadata } from '@types'
import * as z from 'zod'

export const Doc2xApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    code: z.string().min(1),
    data: data.optional(),
    msg: z.string().optional(),
    message: z.string().optional()
  })

export const Doc2xTaskStatusSchema = z.enum(['processing', 'failed', 'success'])

const Doc2xUrlSchema = z
  .string()
  .min(1)
  .transform((value) => decodeEscapedUnicode(value))

export const Doc2xPreuploadDataSchema = z.object({
  uid: z.string().min(1),
  url: Doc2xUrlSchema
})

export const Doc2xParsePageSchema = z.object({
  url: Doc2xUrlSchema.optional(),
  page_idx: z.number(),
  page_width: z.number().optional(),
  page_height: z.number().optional(),
  md: z.string().optional(),
  score: z.number().optional()
})

export const Doc2xParseResultSchema = z.object({
  pages: z.array(Doc2xParsePageSchema).default([])
})

export const Doc2xParseStatusDataSchema = z.object({
  status: Doc2xTaskStatusSchema,
  progress: z.number().int().min(0).max(100).optional(),
  detail: z.string().optional(),
  result: Doc2xParseResultSchema.optional()
})

export const Doc2xExportStatusDataSchema = z.object({
  status: Doc2xTaskStatusSchema,
  url: Doc2xUrlSchema.optional()
})

export const Doc2xPreuploadResponseSchema = Doc2xApiResponseSchema(Doc2xPreuploadDataSchema)
export const Doc2xParseStatusResponseSchema = Doc2xApiResponseSchema(Doc2xParseStatusDataSchema)
export const Doc2xExportStatusResponseSchema = Doc2xApiResponseSchema(Doc2xExportStatusDataSchema)

export type PreparedDoc2xContext = {
  apiHost: string
  apiKey: string
  signal?: AbortSignal
}

export type PreparedDoc2xStartContext = PreparedDoc2xContext & {
  file: FileMetadata
  modelVersion?: string
}

export type PreparedDoc2xQueryContext = PreparedDoc2xContext

export type Doc2xPreuploadData = z.infer<typeof Doc2xPreuploadDataSchema>
export type Doc2xParseStatusData = z.infer<typeof Doc2xParseStatusDataSchema>
export type Doc2xExportStatusData = z.infer<typeof Doc2xExportStatusDataSchema>
export type Doc2xPreuploadResponse = z.infer<typeof Doc2xPreuploadResponseSchema>
export type Doc2xParseStatusResponse = z.infer<typeof Doc2xParseStatusResponseSchema>
export type Doc2xExportStatusResponse = z.infer<typeof Doc2xExportStatusResponseSchema>

export type Doc2xTaskStage = 'parsing' | 'exporting'

export type Doc2xTaskContext = Omit<PreparedDoc2xQueryContext, 'signal'> & {
  fileId: string
  stage: Doc2xTaskStage
  createdAt: number
}

function decodeEscapedUnicode(value: string): string {
  if (!value.includes('\\u')) {
    return value
  }

  try {
    return JSON.parse(JSON.stringify(value).replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1')) as string
  } catch {
    return value
  }
}
