import * as z from 'zod'

export const DOCUMENT_MARKDOWN_MAX_BYTES = 2 * 1024 * 1024

export const documentFormatSchema = z.enum(['md', 'docx', 'pdf', 'pptx', 'xlsx', 'html'])
export type DocumentFormat = z.infer<typeof documentFormatSchema>

export const documentMimeTypes: Record<DocumentFormat, string> = {
  md: 'text/markdown',
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export const documentArtifactSchema = z.object({
  path: z.string(),
  format: documentFormatSchema,
  mime: z.string(),
  warnings: z.array(z.string()).optional()
})

export type DocumentArtifact = z.infer<typeof documentArtifactSchema>

export const documentFormats = documentFormatSchema.options
