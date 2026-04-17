import { AiProvider } from '@renderer/aiCore'
import { getProviderByModel } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { SiliconPaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'
import { TEXT_TO_IMAGES_MODELS } from './defaults'

export async function generateWithSilicon(ctx: GenerateContext) {
  const {
    input: { painting: rawPainting, provider, abortController },
    writers: { patchPainting }
  } = ctx
  const painting = rawPainting as any

  await checkProviderEnabled(provider)

  if (painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
    await FileManager.deleteFiles(painting.files)
  }

  const prompt = painting.prompt || ''
  patchPainting({ prompt } as Partial<PaintingData>)

  const model = TEXT_TO_IMAGES_MODELS.find((item) => item.id === painting.model)
  const resolvedProvider = getProviderByModel(model)

  if (!resolvedProvider.apiKey) {
    throw createPaintingGenerateError('NO_API_KEY')
  }

  if (!painting.model) return

  await runPainting(ctx, async () => {
    const AI = new AiProvider(resolvedProvider)
    const numImages = Number(painting.numImages) || 1

    const urls = await AI.generateImage({
      model: painting.model,
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
