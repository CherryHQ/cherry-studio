import type { Mistral } from '@mistralai/mistralai'
import type { FileMetadata } from '@types'
import * as z from 'zod'

export type PreparedMistralContext = {
  file: FileMetadata
  signal?: AbortSignal
  client: Mistral
  model?: string
}

export type MistralImageDocument = {
  type: 'image_url'
  imageUrl: string
}

export type MistralOcrResponse = Awaited<ReturnType<Mistral['ocr']['process']>>

export const MistralOcrResponseSchema = z.object({
  model: z.string(),
  pages: z
    .array(
      z.object({
        markdown: z.string()
      })
    )
    .min(1),
  usageInfo: z.unknown().optional()
})
