import { AiProvider } from '@renderer/aiCore'
import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'

export async function generateWithZhipu(ctx: GenerateContext) {
  const {
    input: { painting: rawPainting, provider, abortController }
  } = ctx
  const painting = rawPainting as any

  await checkProviderEnabled(provider)

  if (!painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  if (painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
    await FileManager.deleteFiles(painting.files)
  }

  await runPainting(ctx, async () => {
    const aiProvider = new AiProvider(provider)

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
