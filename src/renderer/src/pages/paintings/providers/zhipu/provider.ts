import type { Painting, Provider } from '@renderer/types'

import type { PaintingGenerationResult } from '../types'
import { ZHIPU_QUALITY_MODELS } from './config'

type ZhipuPainting = Painting & {
  model: string
  prompt: string
  numImages: number
  quality?: string
}

type GenerateZhipuImagesOptions = {
  provider: Provider
  painting: ZhipuPainting
  imageSize: string
  signal: AbortSignal
}

type ZhipuImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function getZhipuImageEndpoint(provider: Pick<Provider, 'apiHost'>) {
  return `${provider.apiHost.replace(/\/$/, '')}/images/generations`
}

function buildZhipuImageRequest({ painting, imageSize }: Omit<GenerateZhipuImagesOptions, 'provider'>) {
  return {
    model: painting.model,
    prompt: painting.prompt,
    size: imageSize,
    n: painting.numImages,
    quality: ZHIPU_QUALITY_MODELS.includes(painting.model) ? painting.quality : undefined
  }
}

function parseZhipuImageResponse(data: ZhipuImageResponse): PaintingGenerationResult {
  const images = data.data || []

  return {
    urls: images.filter((item) => item.url).map((item) => item.url as string),
    base64s: images.filter((item) => item.b64_json).map((item) => item.b64_json as string)
  }
}

export async function generateZhipuImages({
  provider,
  painting,
  imageSize,
  signal
}: GenerateZhipuImagesOptions): Promise<PaintingGenerationResult> {
  const response = await fetch(getZhipuImageEndpoint(provider), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildZhipuImageRequest({ painting, imageSize, signal })),
    signal
  })

  const data = (await response
    .json()
    .catch(() => ({ error: { message: `HTTP ${response.status}` } }))) as ZhipuImageResponse

  if (!response.ok) {
    throw new Error(data.error?.message || 'Image generation failed')
  }

  return parseZhipuImageResponse(data)
}
