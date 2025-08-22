import { BuiltinOcrProvider, ImageOcrProvider, OcrProviderCapability } from '@renderer/types/ocr'

const tesseract: BuiltinOcrProvider & ImageOcrProvider = {
  id: 'tesseract',
  name: 'Tesseract',
  capabilities: {
    image: true
  }
} as const

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = [tesseract] as const

export const DEFAULT_OCR_PROVIDER: Record<OcrProviderCapability, BuiltinOcrProvider> = {
  image: tesseract
} as const
