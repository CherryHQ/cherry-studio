import MacOSLogo from '@renderer/assets/images/providers/macos.svg'

export function getOcrProviderLogo(providerId: string) {
  switch (providerId) {
    case 'system':
      return MacOSLogo
    default:
      return undefined
  }
}

export const OCR_PROVIDER_CONFIG = {}
