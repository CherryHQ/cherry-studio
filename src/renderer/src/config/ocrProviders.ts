import Doc2xLogo from '@renderer/assets/images/ocr/doc2x.svg'
export function getOcrProviderLogo(providerId: string) {
  switch (providerId) {
    case 'doc2x':
      return Doc2xLogo
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
  }
}
