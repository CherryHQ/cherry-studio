import * as z from 'zod'

export const DOCUMENT_MARKDOWN_MAX_BYTES = 2 * 1024 * 1024

export const documentFormatSchema = z.enum(['pdf', 'docx', 'pptx', 'xlsx'])
export type DocumentFormat = z.infer<typeof documentFormatSchema>

export const documentMimeTypes: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export const documentArtifactSchema = z.object({
  path: z.string(),
  format: documentFormatSchema,
  mime: z.string()
})

export type DocumentArtifact = z.infer<typeof documentArtifactSchema>
