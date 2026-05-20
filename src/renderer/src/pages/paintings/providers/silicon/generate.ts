import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { SiliconPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { TEXT_TO_IMAGES_MODELS } from './defaults'

export async function generateWithSilicon(input: GenerateInput<SiliconPaintingData>) {
  const { painting, provider, abortController } = input
  const apiKey = await checkProviderEnabled(provider)
  const modelId = painting.model
  if (!modelId) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const prompt = painting.prompt || ''
  if (!prompt.trim()) throw createPaintingGenerateError('PROMPT_REQUIRED')

  // R1: SiliconFlow's signed-CDN URL responses now flow back through the
  // main-process downloader (`downloadImages`); base64-returning models still
  // take the `{ base64s }` branch.
  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId,
    prompt,
    model: TEXT_TO_IMAGES_MODELS.find((item) => item.id === modelId),
    aiSdkParams: {
      negativePrompt: painting.negativePrompt || '',
      imageSize: painting.imageSize || '1024x1024',
      batchSize: Number(painting.numImages) || 1,
      seed: painting.seed || undefined,
      numInferenceSteps: painting.steps || 25,
      guidanceScale: painting.guidanceScale || 4.5,
      promptEnhancement: painting.promptEnhancement || false
    }
  })
}
