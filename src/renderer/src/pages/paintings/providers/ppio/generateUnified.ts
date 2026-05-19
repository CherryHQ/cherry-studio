import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getModelConfig, getModelsByMode } from './config'

/**
 * Unified PPIO painting adapter on the AI-SDK-native `PollingImageModel`
 * (proven `providers/zhipu/generate.ts` pattern). Validation mirrors the
 * bespoke `generateWithPpio` exactly. The PPIO submit/poll transport runs
 * inside the custom `ImageModelV3`; the patched `ai` SDK auto-downloads the
 * returned image URLs into base64 read by `convertImageResult`.
 *
 * Provider-specific painting fields and the polling `onProgress` callback are
 * forwarded through `providerOptions['ppio']` (passed by reference through the
 * plugin chain, so the non-JSON callback survives to `doGenerate`).
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
        }
      }
    }

    const images = await aiProvider.generateImage({
      model: modelId,
      prompt: painting.prompt ?? '',
      imageSize: painting.size ?? '1024x1024',
      batchSize: 1,
      providerOptions: ppioProviderOptions,
      signal: abortController.signal
    })

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
