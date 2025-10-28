import * as z from 'zod'

import { TranslateLanguageCodeSchema } from '../../translate'
import type { OcrProvider } from './base'
import { type ImageOcrProvider, OcrProviderBaseConfigSchema } from './base'
import { type BuiltinOcrProvider } from './base'
import { BuiltinOcrProviderIdMap } from './base'

// ==========================================================
//    System OCR Types
// ==========================================================

export const OcrSystemConfigSchema = OcrProviderBaseConfigSchema.extend({
  langs: z.array(TranslateLanguageCodeSchema).optional()
})

export type OcrSystemConfig = z.infer<typeof OcrSystemConfigSchema>
export const isOcrSystemConfig = (c: unknown): c is OcrSystemConfig => {
  return OcrSystemConfigSchema.safeParse(c).success
}

export type OcrSystemProvider = {
  id: 'system'
  config: OcrSystemConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider

export const isOcrSystemProvider = (p: OcrProvider): p is OcrSystemProvider => {
  return p.id === BuiltinOcrProviderIdMap.system
}
