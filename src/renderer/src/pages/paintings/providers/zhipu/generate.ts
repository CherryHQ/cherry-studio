import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { ZhipuPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { ZHIPU_PAINTING_MODELS } from './config'

/**
 * Resolve Zhipu's `imageSize` from the painting state, enforcing the four
 * CogView custom-size rules (range / divisible-by-16 / pixel-budget /
 * required-when-mode=custom) that `paintingGenerateError` already maps to
 * localized toast messages.
 */
function resolveZhipuImageSize(painting: ZhipuPaintingData): string {
  if (painting.imageSize !== 'custom') return painting.imageSize ?? '1024x1024'
  const { customWidth, customHeight } = painting
  if (!customWidth || !customHeight) throw createPaintingGenerateError('CUSTOM_SIZE_REQUIRED')
  if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
    throw createPaintingGenerateError('CUSTOM_SIZE_RANGE')
  }
  if (customWidth % 16 !== 0 || customHeight % 16 !== 0) throw createPaintingGenerateError('CUSTOM_SIZE_DIVISIBLE')
  if (customWidth * customHeight > 2097152) throw createPaintingGenerateError('CUSTOM_SIZE_PIXELS')
  return `${customWidth}x${customHeight}`
}

export async function generateWithZhipu(input: GenerateInput<ZhipuPaintingData>) {
  const { painting, provider, abortController } = input
  const apiKey = await checkProviderEnabled(provider)
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const prompt = painting.prompt
  if (!prompt?.trim()) throw createPaintingGenerateError('PROMPT_REQUIRED')

  // R1: classify each output so URL-returning Zhipu models (should there be
  // any in the future) route through the main-process downloader. CogView
  // returns base64 today → the `{ base64s }` branch fires.
  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId: painting.model,
    prompt,
    model: ZHIPU_PAINTING_MODELS.find((item) => item.id === painting.model),
    aiSdkParams: {
      negativePrompt: painting.negativePrompt,
      imageSize: resolveZhipuImageSize(painting),
      batchSize: painting.numImages ?? 1,
      quality: painting.quality
    }
  })
}
