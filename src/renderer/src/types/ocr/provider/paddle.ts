import * as z from 'zod'

import type { ImageOcrProvider } from './base'
import type { BuiltinOcrProvider } from './base'
import type { OcrProvider } from './base'
import { OcrProviderBaseConfigSchema } from './base'
import { BuiltinOcrProviderIdMap } from './base'

// ==========================================================
//    PaddleOCR Types
// ==========================================================

export const OcrPpocrConfigSchema = OcrProviderBaseConfigSchema.extend({
  apiUrl: z.string().optional(),
  accessToken: z.string().optional()
})
export type OcrPpocrConfig = z.infer<typeof OcrPpocrConfigSchema>
export const isOcrPpocrConfig = (config: unknown): config is OcrPpocrConfig => {
  return OcrPpocrConfigSchema.safeParse(config).success
}
export type OcrPpocrProvider = {
  id: 'paddleocr'
  config: OcrPpocrConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider
export const isOcrPpocrProvider = (p: OcrProvider): p is OcrPpocrProvider => {
  return p.id === BuiltinOcrProviderIdMap.paddleocr
}
