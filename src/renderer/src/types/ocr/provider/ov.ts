import type * as z from 'zod'

import type { ImageOcrProvider } from './base'
import type { BuiltinOcrProvider } from './base'
import type { OcrProvider } from './base'
import { OcrProviderBaseConfigSchema } from './base'
import { BuiltinOcrProviderIdMap } from './base'

// ==========================================================
//    OV OCR Types
// ==========================================================

export const OcrOvConfigSchema = OcrProviderBaseConfigSchema.extend({
  // It's not configurable for now.
  // langs: z.array(TranslateLanguageCodeSchema).optional()
})
export type OcrOvConfig = z.infer<typeof OcrOvConfigSchema>
export const isOcrOvConfig = (config: unknown): config is OcrOvConfig => {
  return OcrOvConfigSchema.safeParse(config).success
}
export type OcrOvProvider = {
  id: 'ovocr'
  config: OcrOvConfig
} & ImageOcrProvider &
  // PdfOcrProvider &
  BuiltinOcrProvider
export const isOcrOVProvider = (p: OcrProvider): p is OcrOvProvider => {
  return p.id === BuiltinOcrProviderIdMap.ovocr
}
