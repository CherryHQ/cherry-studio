import {
  BuiltinOcrProvider,
  BuiltinOcrProviderId,
  OcrMacProvider,
  OcrProviderCapability,
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

// Not support pdf since no default pdf ocr provider for windows.
const mac: OcrMacProvider = {
  id: 'mac',
  name: 'MacOS Vision OCR',
  config: {},
  capabilities: {
    image: true
    // pdf: true
  }
} as const satisfies OcrMacProvider

export const BUILTIN_OCR_PROVIDERS_MAP = {
  tesseract,
  mac
} as const satisfies Record<BuiltinOcrProviderId, BuiltinOcrProvider>

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = Object.values(BUILTIN_OCR_PROVIDERS_MAP)

export const DEFAULT_OCR_PROVIDER = {
  image: tesseract
} as const satisfies Record<OcrProviderCapability, BuiltinOcrProvider>
