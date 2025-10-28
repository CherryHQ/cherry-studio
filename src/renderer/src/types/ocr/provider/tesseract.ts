import type Tesseract from 'tesseract.js'
import * as z from 'zod'

import { TranslateLanguageCodeSchema } from '../../translate'
import type { ImageOcrProvider } from './base'
import type { BuiltinOcrProvider } from './base'
import type { OcrProvider } from './base'
import { OcrProviderBaseConfigSchema } from './base'
import { BuiltinOcrProviderIdMap } from './base'

// ==========================================================
//    Tesseract OCR Types
// ==========================================================

export const OcrTesseractConfigSchema = OcrProviderBaseConfigSchema.extend({
  langs: z.record(TranslateLanguageCodeSchema, z.boolean()).optional()
})

export type OcrTesseractConfig = z.infer<typeof OcrTesseractConfigSchema>

export const isOcrTesseractConfig = (value: unknown): value is OcrTesseractConfig => {
  return OcrTesseractConfigSchema.safeParse(value).success
}

export type OcrTesseractProvider = {
  id: 'tesseract'
  config: OcrTesseractConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

export const isOcrTesseractProvider = (p: OcrProvider): p is OcrTesseractProvider => {
  return p.id === BuiltinOcrProviderIdMap.tesseract
}

export type TesseractLangCode = Tesseract.LanguageCode
