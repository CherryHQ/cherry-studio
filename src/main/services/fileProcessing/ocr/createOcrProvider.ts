import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import type { OcrProvider } from './OcrProvider'
import { mistralOcrProvider } from './providers/mistralOcrProvider'
import { ovOcrProvider } from './providers/ovOcrProvider'
import { paddleOcrProvider } from './providers/paddleOcrProvider'
import { systemOcrProvider } from './providers/systemOcrProvider'
import { tesseractOcrProvider } from './providers/tesseractOcrProvider'

export function createOcrProvider(processorId: FileProcessorId): OcrProvider {
  switch (processorId) {
    case 'tesseract':
      return tesseractOcrProvider
    case 'system':
      return systemOcrProvider
    case 'paddleocr':
      return paddleOcrProvider
    case 'ovocr':
      return ovOcrProvider
    case 'mistral':
      return mistralOcrProvider
    default:
      throw new Error(`File processor does not support text extraction: ${processorId}`)
  }
}
