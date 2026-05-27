import { AiProvider } from '@renderer/aiCore'
import type { Painting, Provider } from '@renderer/types'

import type { PaintingGenerationResult } from '../types'

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

function buildZhipuImageRequest({ painting, imageSize, signal }: Omit<GenerateZhipuImagesOptions, 'provider'>) {
  return {
    model: painting.model,
    prompt: painting.prompt,
    negativePrompt: painting.negativePrompt,
    imageSize,
    batchSize: painting.numImages,
    quality: painting.quality,
    signal
  }
}

export async function generateZhipuImages({
  provider,
  painting,
  imageSize,
  signal
}: GenerateZhipuImagesOptions): Promise<PaintingGenerationResult> {
  const aiProvider = new AiProvider(provider)
  const base64s = await aiProvider.generateImage(buildZhipuImageRequest({ painting, imageSize, signal }))

  return { urls: [], base64s }
}
