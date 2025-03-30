import Doc2xLogo from '@renderer/assets/images/ocr/doc2x.svg'
import MacOSLogo from '@renderer/assets/images/providers/macos.svg'
import MistralLogo from '@renderer/assets/images/providers/mistral.png'

export function getOcrProviderLogo(providerId: string) {
  switch (providerId) {
    case 'doc2x':
      return Doc2xLogo
    case 'mistral':
      return MistralLogo
    case 'system':
      return MacOSLogo
    default:
      return undefined
  }
}

export const OCR_PROVIDER_CONFIG = {
  doc2x: {
    websites: {
      official: 'https://doc2x.noedgeai.com',
      apiKey: 'https://open.noedgeai.com/apiKeys'
    }
  },
  mistral: {
    websites: {
      official: 'https://mistral.ai',
      apiKey: 'https://mistral.ai/api-keys'
    }
  }
}
