import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getModelConfig, getModelsByMode } from './config'

/**
 * Unified PPIO painting adapter on the AI-SDK-native `PollingImageModel` —
 * the sole PPIO painting path (the bespoke generate.ts was deleted in the
 * cutover). The submit/poll transport runs inside the custom `ImageModelV3`;
 * signed-CDN URL results go through the main-process `downloadImages` (R1)
 * with the bespoke proxy/auth handling, per-URL partial success, and the
 * empty-URL toast intact.
 *
 * Provider-specific painting fields, the polling `onProgress` callback, and
 * the submit-time task-id callback (parity with the bespoke
 * `onGenerationStateChange({ generationTaskId })`) are forwarded through
 * `providerOptions['ppio']` (passed by reference through the plugin chain,
 * so the non-JSON callbacks survive to `doGenerate`).
 */
export async function generateWithPpioUnified(input: GenerateInput<PpioPainting>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  const isEditMode = getModelsByMode('ppio_edit').some((model) => model.id === painting.model)

  if (isEditMode && !painting.imageFile) {
    throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
  }

  const noPromptModels = ['image-upscaler', 'image-remove-background', 'image-eraser']
  if (!noPromptModels.includes(painting.model || '') && !painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  const modelId = painting.model
  if (!modelId) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  const modelConfig = getModelConfig(modelId)
  if (!modelConfig) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  return runPainting(async () => {
    const model = {
      id: modelId,
      provider: provider.id,
      name: modelId,
      group: ''
    } as Model

    const aiProvider = new AiProvider(model, {
      id: provider.id,
      type: 'openai',
      name: provider.name,
      apiKey,
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })

    const ppioProviderOptions = {
      ppio: {
        model: modelId,
        modelDescriptor: { id: modelConfig.id, endpoint: modelConfig.endpoint, isSync: modelConfig.isSync },
        size: painting.size,
        ppioSeed: painting.ppioSeed,
        usePreLlm: painting.usePreLlm,
        addWatermark: painting.addWatermark,
        imageFile: painting.imageFile,
        ppioMask: painting.ppioMask,
        resolution: painting.resolution,
        outputFormat: painting.outputFormat,
        onProgress: (progress: number) => {
          input.onGenerationStateChange?.({ generationProgress: progress })
        },
        onSubmitTaskId: (taskId: string) => {
          input.onGenerationStateChange?.({ generationTaskId: taskId })
        }
      }
    }

    const out = await aiProvider.generatePaintingImage({
      model: modelId,
      prompt: painting.prompt ?? '',
      imageSize: painting.size ?? '1024x1024',
      batchSize: 1,
      providerOptions: ppioProviderOptions,
      signal: abortController.signal
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
