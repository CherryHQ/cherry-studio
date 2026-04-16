import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../settings'
import { createOvmsConfig, DEFAULT_OVMS_PAINTING, getOvmsModels, OVMS_MODELS } from '../config/ovmsConfig'
import { processResult, runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('OvmsProvider')

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
    const { painting, provider, abortController, patchPainting, t } = ctx

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''
    patchPainting({ prompt } as Partial<PaintingCanvas>)

    if (!painting.model || !painting.prompt) return

    await runGeneration(ctx, async () => {
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
          await processResult(ctx, { base64s })
        }

        const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
        if (urls.length > 0) {
          await processResult(ctx, { urls })
        }
      }
    })
  }
}
