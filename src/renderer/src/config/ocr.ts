import { BuiltinOcrProvider, ImageOcrProvider, OcrProviderCapability } from '@renderer/types'

const tesseract: BuiltinOcrProvider & ImageOcrProvider = {
  id: 'tesseract',
  name: 'Tesseract',
  capabilities: {
    image: true
  }
} as const

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = [tesseract] as const

export const DEFAULT_OCR_PROVIDER: Record<OcrProviderCapability, BuiltinOcrProvider & ImageOcrProvider> = {
  image: tesseract
} as const
