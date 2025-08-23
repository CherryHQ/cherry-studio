import {
  BuiltinOcrProvider,
  BuiltinOcrProviderId,
  ImageOcrProvider,
  OcrProviderCapability,
  OcrTesseractProvider
} from '@renderer/types'

const tesseract: BuiltinOcrProvider & ImageOcrProvider & OcrTesseractProvider = {
  id: 'tesseract',
  name: 'Tesseract',
  capabilities: {
    image: true
  },
  config: {
    langs: {
      chi_sim: true,
      chi_tra: true,
      eng: true
    }
  }
} as const satisfies OcrTesseractProvider

export const BUILTIN_OCR_PROVIDERS_MAP = {
  tesseract
} as const satisfies Record<BuiltinOcrProviderId, BuiltinOcrProvider>

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = Object.values(BUILTIN_OCR_PROVIDERS_MAP)

export const DEFAULT_OCR_PROVIDER = {
  image: tesseract
} as const satisfies Record<OcrProviderCapability, BuiltinOcrProvider>
