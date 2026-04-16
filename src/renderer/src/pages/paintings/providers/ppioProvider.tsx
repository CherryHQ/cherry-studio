import { loggerService } from '@logger'
import type { FileMetadata, PaintingCanvas, PpioPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { createModeConfigs, DEFAULT_PPIO_PAINTING, getModelsByMode, type PpioMode } from '../config/ppioConfig'
import { checkProviderEnabled } from '../utils'
import PpioService from '../utils/PpioService'
import { runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('PpioProvider')

const modeConfigs = createModeConfigs()

export const ppioProvider: PaintingProviderDefinition = {
  providerId: 'ppio',

  modes: [
    { value: 'ppio_draw', labelKey: 'paintings.mode.generate' },
    { value: 'ppio_edit', labelKey: 'paintings.mode.edit' }
  ],
  defaultMode: 'ppio_draw',
  modeToDbMode: (mode: string) => (mode === 'ppio_draw' ? 'draw' : 'edit'),

  models: (mode: string) => {
    const models = getModelsByMode(mode as PpioMode)
    return {
      type: 'static' as const,
      options: models.map((m) => ({ label: m.name, value: m.id, group: m.group }))
    }
  },

  configFields: Object.fromEntries(
    Object.entries(modeConfigs).map(([mode, items]) => [mode, items.filter((item) => item.key !== 'model') as any[]])
  ),

  getDefaultPainting: (mode?: string) => {
    const currentMode = (mode || 'ppio_draw') as PpioMode
    const models = getModelsByMode(currentMode)
    return {
      ...DEFAULT_PPIO_PAINTING,
      id: uuid(),
      model: models[0]?.id || DEFAULT_PPIO_PAINTING.model
    }
  },

  onModelChange: (modelId: string) => ({ model: modelId }) as Partial<PaintingCanvas>,

  showTranslate: true,

  async onGenerate(ctx: GenerateContext) {
    const { painting, provider, abortController, patchPainting, setFallbackUrls, t } = ctx

    await checkProviderEnabled(provider, t)

    const ppioPainting = painting as PpioPainting
    const isEditMode = getModelsByMode('ppio_edit').some((m) => m.id === ppioPainting.model)

    if (isEditMode && !ppioPainting.imageFile) {
      window.modal.error({ content: t('paintings.edit.image_required'), centered: true })
      return
    }

    const noPromptModels = ['image-upscaler', 'image-remove-background', 'image-eraser']
    if (!noPromptModels.includes(ppioPainting.model || '') && !ppioPainting.prompt?.trim()) {
      window.modal.error({ content: t('paintings.prompt_required'), centered: true })
      return
    }

    if (!provider.apiKey) {
      window.modal.error({ content: t('error.no_api_key'), centered: true })
      return
    }

    if (painting.files && painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
    }

    await runGeneration(ctx, async () => {
      try {
        const service = new PpioService(provider.apiKey)

        logger.info('Starting image generation', { model: ppioPainting.model })

        const result = await service.generate(ppioPainting)

        let imageUrls: string[] = []

        if (result.images) {
          imageUrls = result.images
        } else if (result.taskId) {
          logger.info('Task created', { taskId: result.taskId })
          patchPainting({ taskId: result.taskId, ppioStatus: 'processing' } as Partial<PaintingCanvas>)

          const taskResult = await service.pollTaskResult(result.taskId, {
            signal: abortController.signal,
            onProgress: (progress) => {
              logger.debug('Task progress', { progress })
            }
          })

          logger.info('Task completed', taskResult)

          if (taskResult.images && taskResult.images.length > 0) {
            imageUrls = taskResult.images.map((img) => img.image_url)
          }
        }

        if (imageUrls.length > 0) {
          const downloadedFiles = await Promise.all(
            imageUrls.map(async (url) => {
              try {
                if (!url || url.trim() === '') {
                  logger.error('Empty image URL')
                  return null
                }
                return await window.api.file.download(url)
              } catch (error) {
                logger.error('Failed to download image:', error as Error)
                return null
              }
            })
          )

          const validFiles = downloadedFiles.filter((file): file is FileMetadata => file !== null)
          patchPainting({ ppioStatus: 'succeeded' } as Partial<PaintingCanvas>)
          setFallbackUrls(imageUrls)
          return { files: validFiles }
        }
      } catch (error) {
        patchPainting({ ppioStatus: 'failed' } as Partial<PaintingCanvas>)
        throw error
      }
    })
  }
}
