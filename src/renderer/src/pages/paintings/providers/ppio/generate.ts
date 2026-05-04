import type { FileMetadata } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateInput } from '../types'
import { getModelsByMode } from './config'
import PpioService from './service'

export async function generateWithPpio(input: GenerateInput<PpioPainting>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  const ppioPainting = painting
  const isEditMode = getModelsByMode('ppio_edit').some((model) => model.id === ppioPainting.model)

  if (isEditMode && !ppioPainting.imageFile) {
    throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
  }

  const noPromptModels = ['image-upscaler', 'image-remove-background', 'image-eraser']
  if (!noPromptModels.includes(ppioPainting.model || '') && !ppioPainting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  return runPainting(async () => {
    const service = new PpioService(apiKey)
    const result = await service.generate(ppioPainting, abortController.signal)

    let imageUrls: string[] = []

    if (result.images) {
      imageUrls = result.images
    } else if (result.taskId) {
      input.onGenerationStateChange?.({ generationTaskId: result.taskId })
      const taskResult = await service.pollTaskResult(result.taskId, {
        signal: abortController.signal,
        onProgress: (progress) => {
          input.onGenerationStateChange?.({ generationProgress: progress })
        }
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
      return { files: validFiles }
    }

    return undefined
  })
}
