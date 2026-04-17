import type { FileMetadata } from '@renderer/types'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { PaintingData, PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'
import { getModelsByMode } from './config'
import PpioService from './service'

export async function generateWithPpio(ctx: GenerateContext) {
  const {
    input: { painting, provider, abortController },
    writers: { patchPainting, setFallbackUrls }
  } = ctx

  await checkProviderEnabled(provider)

  const ppioPainting = painting as PpioPainting
  const isEditMode = getModelsByMode('ppio_edit').some((model) => model.id === ppioPainting.model)

  if (isEditMode && !ppioPainting.imageFile) {
    throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
  }

  const noPromptModels = ['image-upscaler', 'image-remove-background', 'image-eraser']
  if (!noPromptModels.includes(ppioPainting.model || '') && !ppioPainting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  if (!provider.apiKey) {
    throw createPaintingGenerateError('NO_API_KEY')
  }

  if (painting.files && painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
  }

  await runPainting(ctx, async () => {
    try {
      const service = new PpioService(provider.apiKey)
      const result = await service.generate(ppioPainting, abortController.signal)

      let imageUrls: string[] = []

      if (result.images) {
        imageUrls = result.images
      } else if (result.taskId) {
        patchPainting({ taskId: result.taskId, taskStatus: 'processing' } as Partial<PaintingData>)

        const taskResult = await service.pollTaskResult(result.taskId, {
          signal: abortController.signal,
          onProgress: () => {}
        })

        if (taskResult.images && taskResult.images.length > 0) {
          imageUrls = taskResult.images.map((img) => img.image_url)
        }
      }

      if (imageUrls.length > 0) {
        const downloadedFiles = await Promise.all(
          imageUrls.map(async (url) => {
            try {
              if (!url || url.trim() === '') {
                return null
              }
              return await window.api.file.download(url)
            } catch {
              return null
            }
          })
        )

        const validFiles = downloadedFiles.filter((file): file is FileMetadata => file !== null)
        patchPainting({ taskStatus: 'succeeded' } as Partial<PaintingData>)
        setFallbackUrls(imageUrls)
        return { files: validFiles }
      }

      return undefined
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        patchPainting({ taskStatus: 'cancelled' } as Partial<PaintingData>)
        throw error
      }

      patchPainting({ taskStatus: 'failed' } as Partial<PaintingData>)
      throw error
    }
  })
}
