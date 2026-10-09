import type { Provider } from './types'
import { openaiCompatible } from './types'

export const minimaxOverrides = [
  {
    modelId: 'minimax-m3-1-flash-preview',
    apiModelId: 'MiniMax-M3.1-Flash-Preview',
    endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
    reasoningContracts: {
      'anthropic-messages': {
        wire: {
          effort: { operations: [{ target: 'effort', value: { source: 'effort' } }] }
        }
      }
    }
  },
  {
    modelId: 'minimax-m3',
    endpointTypes: ['openai-chat-completions', 'anthropic-messages']
  },
  {
    modelId: 'image-01',
    imageGeneration: {
      supports: {
        addWatermark: {
          default: false,
          type: 'switch'
        },
        aspectRatio: {
          options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
          render: 'chips',
          type: 'enum'
        },
        customSize: {
          maxSide: 2048,
          minSide: 512,
          pairedEnumKey: 'size',
          type: 'size'
        },
        numImages: {
          default: 1,
          max: 9,
          min: 1,
          type: 'range'
        },
        outputFormat: {
          default: 'url',
          options: ['url', 'base64'],
          type: 'enum'
        },
        promptEnhancement: {
          default: false,
          type: 'switch'
        },
        seed: {
          type: 'text'
        },
        size: {
          options: ['custom'],
          type: 'enum'
        }
      },
      inputs: {
        images: {
          min: 0,
          max: {
            kind: 'unknown'
          }
        },
        prompt: 'required',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      },
      protocol: {
        kind: 'custom',
        endpoint: '/image_generation',
        isSync: true
      }
    }
  },
  {
    modelId: 'image-01-live',
    imageGeneration: {
      supports: {
        addWatermark: {
          default: false,
          type: 'switch'
        },
        aspectRatio: {
          options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
          render: 'chips',
          type: 'enum'
        },
        numImages: {
          default: 1,
          max: 9,
          min: 1,
          type: 'range'
        },
        outputFormat: {
          default: 'url',
          options: ['url', 'base64'],
          type: 'enum'
        },
        promptEnhancement: {
          default: false,
          type: 'switch'
        },
        seed: {
          type: 'text'
        }
      },
      inputs: {
        images: {
          min: 0,
          max: {
            kind: 'unknown'
          }
        },
        prompt: 'required',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      },
      protocol: {
        kind: 'custom',
        endpoint: '/image_generation',
        isSync: true
      }
    }
  }
] satisfies NonNullable<Provider['overrides']>

export default openaiCompatible({
  id: 'minimax',
  name: 'MiniMax',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.minimaxi.com/v1/',
  anthropic: 'https://api.minimaxi.com/anthropic',
  website: {
    apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docs: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
    models: 'https://platform.minimaxi.com/document/Models',
    official: 'https://platform.minimaxi.com/'
  },
  overrides: minimaxOverrides
})
