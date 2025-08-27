import TesseractLogo from '@renderer/assets/images/providers/Tesseract.js.png'
import { isBuiltinOcrProviderId } from '@renderer/types'

export function getOcrProviderLogo(providerId: string) {
  if (isBuiltinOcrProviderId(providerId)) {
    switch (providerId) {
      case 'tesseract':
        return TesseractLogo
    }
  }
  return undefined
}
