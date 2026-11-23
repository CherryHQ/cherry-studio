import type { ImageModeDef } from '../schemas/model'
import { openaiCompatible } from './types'

const SEEDREAM_ASPECT_RATIOS = [
  '1:1',
  '1:2',
  '2:1',
  '1:3',
  '3:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '9:21',
  '21:9'
]

const seedreamSupports = (aspectRatioDefault?: string): ImageModeDef['supports'] => ({
  aspectRatio: {
    type: 'enum',
    options: SEEDREAM_ASPECT_RATIOS,
    ...(aspectRatioDefault && { default: aspectRatioDefault }),
    render: 'chips'
  },
  imageResolution: { type: 'enum', options: ['1K', '1.5K', '2K'], default: '1K', render: 'chips' },
  outputFormat: { type: 'enum', options: ['png', 'jpeg'], default: 'png' },
  background: { type: 'enum', options: ['auto', 'transparent', 'opaque'], default: 'auto' }
})

/**
 * WaveSpeed's LLM gateway lists its `vendor/model` chat ids at `/v1/models`. Image models live on the
 * prediction API (`https://api.wavespeed.ai/api/v3/<model id>`), which that list omits; main's wavespeed
 * transport executes the per-mode `vendorTransport` endpoints below.
 */
export default openaiCompatible({
  id: 'wavespeed',
  name: 'WaveSpeed',
  supplementModelsFromRegistry: true,
  availableInEditions: ['global'],
  baseUrl: 'https://llm.wavespeed.ai/v1',
  website: {
    apiKey: 'https://wavespeed.ai/accesskey',
    docs: 'https://wavespeed.ai/docs',
    models: 'https://wavespeed.ai/models',
    official: 'https://wavespeed.ai'
  },
  overrides: [
    {
      modelId: 'doubao-seedream-5-5',
      apiModelId: 'bytedance/seedream-v5.5',
      imageGeneration: {
        modes: {
          generate: {
            supports: seedreamSupports('1:1'),
            vendorTransport: { endpoint: '/api/v3/bytedance/seedream-v5.5' }
          },
          edit: {
            maxInputImages: 10,
            supports: seedreamSupports(),
            vendorTransport: { endpoint: '/api/v3/bytedance/seedream-v5.5/edit' }
          }
        }
      }
    }
  ]
})
