import { isMac, isWin } from '@renderer/config/constant'
import type { OcrProviderCapability } from '@renderer/types'
import { systemOcr, tesseract } from '@shared/config/ocr'

export const getDefaultOcrProvider = (cap: OcrProviderCapability) => {
  switch (cap) {
    case 'image':
      return isWin || isMac ? systemOcr : tesseract
  }
}
