import {
  BuiltinOcrProvider,
  BuiltinOcrProviderId,
  OcrProviderCapability,
  OcrSystemProvider,
  OcrTesseractProvider
} from '@renderer/types'

const tesseract: OcrTesseractProvider = {
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
} as const

const systemOcr: OcrSystemProvider = {
  id: 'system',
  name: 'System',
  config: {},
  capabilities: {
    image: true
    // pdf: true
  }
} as const satisfies OcrSystemProvider

export const BUILTIN_OCR_PROVIDERS_MAP = {
  tesseract,
  system: systemOcr
} as const satisfies Record<BuiltinOcrProviderId, BuiltinOcrProvider>

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = Object.values(BUILTIN_OCR_PROVIDERS_MAP)

export const DEFAULT_OCR_PROVIDER = {
  image: tesseract
} as const satisfies Record<OcrProviderCapability, BuiltinOcrProvider>
