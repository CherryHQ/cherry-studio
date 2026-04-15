import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, PaintingAction } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../settings'
import { createOvmsConfig, DEFAULT_OVMS_PAINTING, getOvmsModels, OVMS_MODELS } from '../config/ovmsConfig'
import type { GenerateContext, PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('OvmsProvider')

const downloadImages = async (urls: string[], t: (key: string) => string): Promise<FileMetadata[]> => {
  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!url?.trim()) {
          logger.error('Image URL is empty, possibly due to prohibited prompt')
          window.toast.warning(t('message.empty_url'))
          return null
        }
        return await window.api.file.download(url)
      } catch (error) {
        logger.error(`Failed to download image: ${error}`)
        if (
          error instanceof Error &&
          (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
        ) {
          window.toast.warning(t('message.empty_url'))
        }
        return null
      }
    })
  )
  return downloadedFiles.filter((file): file is FileMetadata => file !== null)
}

export const ovmsProvider: PaintingProviderDefinition = {
  providerId: 'ovms',

  models: {
    type: 'dynamic',
    resolver: (provider) => getOvmsModels(provider.models)
  },

  configFields: createOvmsConfig().filter((item) => item.key !== 'model') as any[],

  getDefaultPainting: (_mode, models) => {
    const availableModels = models || OVMS_MODELS
    return {
      ...DEFAULT_OVMS_PAINTING,
      id: uuid(),
      model: availableModels[0]?.value || ''
    }
  },

  onModelChange: (modelId) => ({ model: modelId }),

  showTranslate: false,

  providerHeaderExtra: (_provider, t) => {
    const Icon = resolveProviderIcon('ovms')
    return (
      <SettingHelpLink
        target="_blank"
        href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
        {t('paintings.learn_more')}
        {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
      </SettingHelpLink>
    )
  },

  promptDisabled: (painting, isLoading) => isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value,

  async onGenerate(ctx: GenerateContext) {
    const { painting, provider, abortController, updatePaintingState, setIsLoading, setGenerating, t } = ctx

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''
    updatePaintingState({ prompt } as Partial<PaintingAction>)

    if (!painting.model || !painting.prompt) return

    setIsLoading(true)
    setGenerating(true)

    try {
      const requestBody = {
        model: painting.model,
        prompt: painting.prompt,
        size: painting.size || '512x512',
        num_inference_steps: painting.num_inference_steps || 4,
        rng_seed: painting.rng_seed || 0
      }

      logger.info('OVMS API request:', requestBody)

      const response = await fetch(`${provider.apiHost}images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }))
        logger.error('OVMS API error:', errorData)
        throw new Error(errorData.error?.message || 'Image generation failed')
      }

      const data = await response.json()
      logger.info('OVMS API response:', data)

      if (data.data && data.data.length > 0) {
        const base64s = data.data.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)

        if (base64s.length > 0) {
          const validFiles = await Promise.all(
            base64s.map(async (base64: string) => window.api.file.saveBase64Image(base64))
          )
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls: [] } as Partial<PaintingAction>)
        }

        const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
        if (urls.length > 0) {
          const validFiles = await downloadImages(urls, t)
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls } as Partial<PaintingAction>)
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content: getErrorMessage(error),
          centered: true
        })
      }
    } finally {
      setIsLoading(false)
      setGenerating(false)
    }
  }
}
