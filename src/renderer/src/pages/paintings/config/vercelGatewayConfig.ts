import type { VercelGatewayPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export const MODELS_BASE = {
  group: 'Vercel',
  output_format: [{ value: 'image/png' }, { value: 'image/jpeg' }, { value: 'image/webp' }],
  background: [{ value: 'auto' }, { value: 'transparent' }, { value: 'opaque' }]
}
export const MODELS = [
  {
    label: 'FLUX.2 [flex]',
    name: 'bfl/flux-2-flex'
  },
  {
    label: 'FLUX.2 [klein] 4B',
    name: 'bfl/flux-2-klein-4b'
  },
  {
    label: 'FLUX.2 [klein] 9B',
    name: 'bfl/flux-2-klein-9b'
  },
  {
    label: 'FLUX.2 [max]',
    name: 'bfl/flux-2-max'
  },
  {
    label: 'FLUX.2 [pro]',
    name: 'bfl/flux-2-pro'
  },
  {
    label: 'FLUX.1 Kontext Max',
    name: 'bfl/flux-kontext-max'
  },
  {
    label: 'FLUX.1 Kontext Pro',
    name: 'bfl/flux-kontext-pro'
  },
  {
    label: 'FLUX.1 Fill [pro]',
    name: 'bfl/flux-pro-1.0-fill'
  },
  {
    label: 'FLUX1.1 [pro]',
    name: 'bfl/flux-pro-1.1'
  },
  {
    label: 'FLUX1.1 [pro] Ultra',
    name: 'bfl/flux-pro-1.1-ultra'
  },
  {
    label: 'Seedream 4.0',
    name: 'bytedance/seedream-4.0'
  },
  {
    label: 'Seedream 4.5',
    name: 'bytedance/seedream-4.5'
  },
  {
    label: 'Seedream 5.0 Lite',
    name: 'bytedance/seedream-5.0-lite'
  },
  {
    label: 'Imagen 4 Fast',
    name: 'google/imagen-4.0-fast-generate-001'
  },
  {
    label: 'Imagen 4',
    name: 'google/imagen-4.0-generate-001'
  },
  {
    label: 'Imagen 4 Ultra',
    name: 'google/imagen-4.0-ultra-generate-001'
  },
  {
    label: 'GPT Image 1',
    name: 'openai/gpt-image-1'
  },
  {
    label: 'GPT Image 1 Mini',
    name: 'openai/gpt-image-1-mini'
  },
  {
    label: 'GPT Image 1.5',
    name: 'openai/gpt-image-1.5'
  },
  {
    label: 'GPT Image 2',
    name: 'openai/gpt-image-2'
  },
  {
    label: 'Flux Schnell',
    name: 'prodia/flux-fast-schnell'
  },
  {
    label: 'Recraft V2',
    name: 'recraft/recraft-v2'
  },
  {
    label: 'Recraft V3',
    name: 'recraft/recraft-v3'
  },
  {
    label: 'Recraft V4',
    name: 'recraft/recraft-v4'
  },
  {
    label: 'Recraft V4 Pro',
    name: 'recraft/recraft-v4-pro'
  },
  {
    label: 'Grok Imagine Image',
    name: 'xai/grok-imagine-image'
  },
  {
    label: 'Grok Imagine Image Pro',
    name: 'xai/grok-imagine-image-pro'
  }
].map((m) => ({
  ...MODELS_BASE,
  ...m
}))

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
      images: any[]
      costInUsdTicks: number
    }
    gateway: {
      routing: {
        originalModelId: string
        resolvedProvider: string
        resolvedProviderApiModelId: string
        fallbacksAvailable: any[]
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
