import { canonicalGenerate } from '../../model/canonicalGenerate'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import type { PpioPaintingData as PpioPainting } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'
import { getModelConfig, getModelsByMode } from './models'

/** Models that accept an empty prompt (the painting page enforces non-empty by default). */
const NO_PROMPT_MODELS = new Set(['image-upscaler', 'image-remove-background', 'image-eraser'])

/**
 * Unified PPIO painting adapter.
 *
 * PPIO's transport (submit/poll via `PpioTransport`) lives in the custom
 * `ImageModelV3`; signed-CDN URL results route back through the main-process
 * `downloadImages` (R1). Per-model endpoint routing and sync/async dispatch
 * come from `PPIO_MODELS` (transport routing table, not a UI catalog) — the
 * dropdown source itself is the user's enabled image-gen models filtered by
 * `loadPaintingModelOptions(providerId)` (Stage 3).
 *
 * `onProgress` / `onSubmitTaskId` callbacks are forwarded via providerBag so
 * non-JSON references survive the AI-SDK plugin chain to PpioTransport.
 */
export async function generateWithPpioUnified(input: GenerateInput<PpioPainting>) {
  return canonicalGenerate(input, {
    requirePrompt: (painting) => !painting.model || !NO_PROMPT_MODELS.has(painting.model),
    preValidate: (painting) => {
      const modelId = painting.model
      if (!modelId) return // canonicalGenerate's MISSING_REQUIRED_FIELDS will fire next
      if (!getModelConfig(modelId)) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
      if (getModelsByMode('ppio_edit').some((m) => m.id === modelId) && !painting.imageFile) {
        throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
      }
    },
    fieldMap: { imageSize: 'size' },
    defaults: { imageSize: '1024x1024', batchSize: 1 },
    providerBag: (painting) => {
      const modelConfig = painting.model ? getModelConfig(painting.model) : undefined
      return {
        model: painting.model,
        modelDescriptor: modelConfig
          ? { id: modelConfig.id, endpoint: modelConfig.endpoint, isSync: modelConfig.isSync }
          : undefined,
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
  })
}
