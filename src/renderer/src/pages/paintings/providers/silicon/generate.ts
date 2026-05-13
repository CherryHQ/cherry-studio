import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { SiliconPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { TEXT_TO_IMAGES_MODELS } from './defaults'

export async function generateWithSilicon(input: GenerateInput<SiliconPaintingData>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  const prompt = painting.prompt || ''
  const modelId = painting.model

  if (!modelId) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  if (!prompt.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  return runPainting(async () => {
    const model =
      TEXT_TO_IMAGES_MODELS.find((item) => item.id === modelId) ||
      ({
        id: modelId,
        provider: provider.id,
        name: modelId,
        group: ''
      } as Model)
    const AI = new AiProvider(model, {
      id: provider.id,
      type: 'openai',
      name: provider.name,
      apiKey,
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })
    const numImages = Number(painting.numImages) || 1

    const urls = await AI.generateImage({
      model: modelId,
      prompt,
      negativePrompt: painting.negativePrompt || '',
      imageSize: painting.imageSize || '1024x1024',
      batchSize: numImages,
      seed: painting.seed || undefined,
      numInferenceSteps: painting.steps || 25,
      guidanceScale: painting.guidanceScale || 4.5,
      signal: abortController.signal,
      promptEnhancement: painting.promptEnhancement || false
    })

    if (urls.length > 0) {
      return { urls }
    }

    return undefined
  })
}
