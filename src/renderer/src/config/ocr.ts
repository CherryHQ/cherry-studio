import { BuiltinOcrProvider } from '@renderer/types/ocr'

export const BUILTIN_OCR_PROVIDERS: BuiltinOcrProvider[] = [
  {
    id: 'tesseract',
    name: 'Tesseract',
    capabilities: {
      image: true
    }
  }
] as const
