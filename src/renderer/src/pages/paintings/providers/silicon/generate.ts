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

    // R1: SiliconFlow's signed-CDN URL responses now flow back through the
    // main-process downloader (`downloadImages`) instead of the renderer
    // `fetch` the patched SDK would otherwise use. Base64-returning models
    // still take the `{ base64s }` branch.
    const out = await AI.generatePaintingImage({
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

    const urls = out.flatMap((o) => (o.type === 'url' ? [o.url] : []))
    if (urls.length > 0) {
      return { urls }
    }
    const base64s = out.flatMap((o) => (o.type === 'base64' ? [o.base64] : []))
    if (base64s.length > 0) {
      return { base64s }
    }

    return undefined
  })
}
