import type { Mistral } from '@mistralai/mistralai'
import type { FileInfo } from '@shared/types/file'
import * as z from 'zod'

export type PreparedMistralContext = {
  file: FileInfo
  signal?: AbortSignal
  client: Mistral
  model?: string
}

export type MistralImageDocument = {
  type: 'image_url'
  imageUrl: string
}

export type MistralDocumentUrlDocument = {
  type: 'document_url'
  documentUrl: string
}

export type MistralOcrResponse = Awaited<ReturnType<Mistral['ocr']['process']>>

export const MistralOcrResponseSchema = z.object({
  model: z.string(),
  pages: z
    .array(
      z.object({
        markdown: z.string(),
        tables: z
          .array(
            z.object({
              id: z.string(),
              content: z.string()
            })
          )
          .optional()
      })
    )
    .min(1),
  usageInfo: z.unknown().optional()
})

export type MistralOcrPage = z.infer<typeof MistralOcrResponseSchema>['pages'][number]
