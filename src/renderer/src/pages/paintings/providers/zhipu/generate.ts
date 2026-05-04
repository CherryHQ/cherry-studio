import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import { checkProviderEnabled } from '../../utils'
import type { GenerateInput } from '../types'
import { ZHIPU_PAINTING_MODELS } from './config'

export async function generateWithZhipu(input: GenerateInput) {
  const { painting: rawPainting, provider, abortController } = input
  const painting = rawPainting as any

  const apiKey = await checkProviderEnabled(provider)

  if (!painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  return runPainting(async () => {
    const model =
      ZHIPU_PAINTING_MODELS.find((item) => item.id === painting.model) ||
      ({
        id: painting.model,
        provider: provider.id,
        name: painting.model,
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
      const customWidth = painting.customWidth as number | undefined
      const customHeight = painting.customHeight as number | undefined

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
      model: painting.model,
      prompt: painting.prompt,
      negativePrompt: painting.negativePrompt,
      imageSize: actualImageSize,
      batchSize: painting.numImages,
      quality: painting.quality,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
