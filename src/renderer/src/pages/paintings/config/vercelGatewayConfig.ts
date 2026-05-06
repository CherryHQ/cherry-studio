import type { VercelGatewayPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const SUPPORTED_MODELS = ['xai/grok-imagine-image', 'gptimage-1']

export const MODELS = [
  {
    name: 'xai/grok-imagine-image',
    group: 'Vercel',
    imageSizes: [
      { value: 'auto' },
      { value: '512x512' },
      { value: '1024x1024' },
      { value: '1536x1024' },
      { value: '1024x1536' }
    ],
    max_images: 10,
    quality: [{ value: 'auto' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
    moderation: [{ value: 'auto' }, { value: 'low' }],
    output_compression_format: [{ value: 'jpeg' }, { value: 'webp' }],
    output_format: [{ value: 'image/png' }, { value: 'image/jpeg' }, { value: 'image/webp' }],
    background: [{ value: 'auto' }, { value: 'transparent' }, { value: 'opaque' }]
  }
]

export const DEFAULT_VERCEL_GATEWAY_PAINTING: VercelGatewayPainting = {
  id: uuid(),
  urls: [],
  files: [],
  model: '',
  prompt: '',
  quality: 'auto',
  n: 1,
  background: 'auto',
  moderation: 'auto',
  size: 'auto'
}

export type VercelGatewayPaintingResponse = {
  created: number
  data: Array<{
    url?: string
    b64_json?: string
  }>
  usage: {
    total_tokens: number
    input_tokens: number
    output_tokens: number
  }
  providerMetadata: {
    xai: {
      images: [{}]
      costInUsdTicks: 200000000
    }
    gateway: {
      routing: {
        originalModelId: string
        resolvedProvider: string
        resolvedProviderApiModelId: string
        fallbacksAvailable: []
        planningReasoning: string
        canonicalSlug: string
        finalProvider: string
        modelAttemptCount: number
        modelAttempts: [
          {
            modelId: string
            canonicalSlug: string
            success: boolean
            providerAttemptCount: number
            providerAttempts: [
              {
                provider: string
                internalModelId: string
                providerApiModelId: string
                credentialType: string
                success: boolean
                startTime: number
                endTime: number
                statusCode: number
              }
            ]
          }
        ]
        totalProviderAttemptCount: number
      }
      cost: string
      marketCost: string
      inferenceCost: string
      inputInferenceCost: string
      outputInferenceCost: string
      generationId: string
    }
  }
}
