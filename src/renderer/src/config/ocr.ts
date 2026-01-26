import type {
  BuiltinOcrProvider,
  BuiltinOcrProviderId,
  OcrOvProvider,
  OcrPpocrProvider,
  OcrProviderCapability,
  OcrSystemProvider,
  OcrTesseractProvider
} from '@renderer/types'

import { isMac, isWin } from './constant'

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
  config: {
    langs: isWin ? ['en-us'] : undefined
  },
  capabilities: {
    image: true
    // pdf: true
  }
} as const satisfies OcrSystemProvider

const ppocrOcr: OcrPpocrProvider = {
  id: 'paddleocr',
  name: 'PaddleOCR',
  config: {
    apiUrl: ''
  },
  capabilities: {
    image: true
    // pdf: true
  }
} as const

const ovOcr: OcrOvProvider = {
  id: 'ovocr',
  name: 'Intel OV(NPU) OCR',
  config: {
    langs: isWin ? ['en-us', 'zh-cn'] : undefined
  },
  capabilities: {
    image: true
    // pdf: true
  }
} as const satisfies OcrOvProvider

export const BUILTIN_OCR_PROVIDERS_MAP = {
  tesseract,
  system: systemOcr,
  paddleocr: ppocrOcr,
  ovocr: ovOcr
} as const satisfies Record<BuiltinOcrProviderId, BuiltinOcrProvider>

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = Object.values(BUILTIN_OCR_PROVIDERS_MAP)

export const DEFAULT_OCR_PROVIDER = {
  image: isWin || isMac ? systemOcr : tesseract
} as const satisfies Record<OcrProviderCapability, BuiltinOcrProvider>
