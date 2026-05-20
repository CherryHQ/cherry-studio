import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getModelConfig, getModelsByMode } from './config'

/**
 * Unified PPIO painting adapter. The submit/poll transport runs inside the
 * custom `ImageModelV3`; signed-CDN URL results go through the main-process
 * `downloadImages` (R1) with proxy/auth handling, per-URL partial success,
 * and the empty-URL toast intact.
 *
 * `onProgress` (polling progress) and `onSubmitTaskId` (parity with the
 * bespoke `onGenerationStateChange({ generationTaskId })`) are forwarded by
 * reference through `providerOptions['ppio']` so the non-JSON callbacks
 * survive the plugin chain to `PpioTransport.submit`/`poll`.
 */
const NO_PROMPT_MODELS = new Set(['image-upscaler', 'image-remove-background', 'image-eraser'])

export async function generateWithPpioUnified(input: GenerateInput<PpioPainting>) {
  const { painting, provider, abortController } = input
  const apiKey = await checkProviderEnabled(provider)
  const modelId = painting.model
  if (!modelId) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const modelConfig = getModelConfig(modelId)
  if (!modelConfig) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  if (getModelsByMode('ppio_edit').some((m) => m.id === modelId) && !painting.imageFile) {
    throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
  }
  if (!NO_PROMPT_MODELS.has(modelId) && !painting.prompt?.trim()) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId,
    prompt: painting.prompt ?? '',
    aiSdkParams: {
      imageSize: painting.size ?? '1024x1024',
      batchSize: 1
    },
    providerBag: {
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
  })
}
