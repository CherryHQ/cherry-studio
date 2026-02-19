import { PROVIDER_ICON_CATALOG } from '@cherrystudio/ui'
import type { PreprocessProviderId } from '@renderer/types'

export function getPreprocessProviderLogo(providerId: PreprocessProviderId) {
  switch (providerId) {
    case 'doc2x':
      return PROVIDER_ICON_CATALOG.doc2x
    case 'mistral':
      return PROVIDER_ICON_CATALOG.mistral
    case 'mineru':
      return PROVIDER_ICON_CATALOG.mineru
    case 'open-mineru':
      return PROVIDER_ICON_CATALOG.mineru
    default:
      return undefined
  }
}

type PreprocessProviderConfig = { websites: { official: string; apiKey: string } }

export const PREPROCESS_PROVIDER_CONFIG: Record<PreprocessProviderId, PreprocessProviderConfig> = {
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
  },
  mineru: {
    websites: {
      official: 'https://mineru.net/',
      apiKey: 'https://mineru.net/apiManage'
    }
  },
  'open-mineru': {
    websites: {
      official: 'https://github.com/opendatalab/MinerU/',
      apiKey: 'https://github.com/opendatalab/MinerU/'
    }
  }
}
