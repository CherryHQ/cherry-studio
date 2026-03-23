import { Doc2x, Mineru, Mistral, Paddleocr } from '@cherrystudio/ui/icons'
import type { PreprocessProviderId } from '@renderer/types'

export function getPreprocessProviderLogo(providerId: PreprocessProviderId) {
  switch (providerId) {
    case 'doc2x':
      return Doc2x
    case 'mistral':
      return Mistral
    case 'mineru':
      return Mineru
    case 'open-mineru':
      return Mineru
    case 'paddleocr':
      return Paddleocr
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
  },
  paddleocr: {
    websites: {
      official: 'https://aistudio.baidu.com/paddleocr/',
      apiKey: 'https://aistudio.baidu.com/paddleocr/'
    }
  }
}
