import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { ZhipuPaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { ZHIPU_PAINTING_MODELS } from './config'

export async function generateWithZhipu(input: GenerateInput<ZhipuPaintingData>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  if (!painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  const modelId = painting.model
  if (!modelId) return []

  return runPainting(async () => {
    const model =
      ZHIPU_PAINTING_MODELS.find((item) => item.id === modelId) ||
      ({
        id: modelId,
        provider: provider.id,
        name: modelId,
        group: ''
      } as Model)
    const aiProvider = new AiProvider(model, {
      id: provider.id,
      type: 'openai',
      name: provider.name,
      apiKey,
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })

    let actualImageSize = painting.imageSize

    if (painting.imageSize === 'custom') {
      const customWidth = painting.customWidth
      const customHeight = painting.customHeight

      if (!customWidth || !customHeight) {
        throw createPaintingGenerateError('CUSTOM_SIZE_REQUIRED')
      }

      if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
        throw createPaintingGenerateError('CUSTOM_SIZE_RANGE')
      }

      if (customWidth % 16 !== 0 || customHeight % 16 !== 0) {
        throw createPaintingGenerateError('CUSTOM_SIZE_DIVISIBLE')
      }

      if (customWidth * customHeight > 2097152) {
        throw createPaintingGenerateError('CUSTOM_SIZE_PIXELS')
      }

      actualImageSize = `${customWidth}x${customHeight}`
    }

    const images = await aiProvider.generateImage({
      model: modelId,
      prompt: painting.prompt,
      negativePrompt: painting.negativePrompt,
      imageSize: actualImageSize ?? '1024x1024',
      batchSize: painting.numImages ?? 1,
      quality: painting.quality,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
