import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types/file'
import { uuid } from '@renderer/utils/uuid'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'

import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import { canonicalGenerate } from './canonicalGenerate'
import type { GenerateInput } from './types/generateInput'
import type { PaintingData } from './types/paintingData'

const logger = loggerService.withContext('paintings/paintingPipeline')

/**
 * Build an initial `PaintingData` row for a new painting under the given
 * provider. Single empty shape — every per-model knob lives in
 * `params: Record<string, unknown>` and gets populated by the form when the
 * user picks a model + edits controls.
 */
export function createDefaultPainting(providerId: string): PaintingData {
  return { id: uuid(), providerId, mode: 'generate', prompt: '', files: [], params: {} }
}

/**
 * Generic painting generate dispatch — the same flow for every provider:
 *
 *   1. Look up the model's `imageGeneration` block via DataApi.
 *   2. If the model declares per-mode `vendorTransport` (PPIO async
 *      endpoints, future custom-transport vendors), inject the descriptor
 *      into `painting.params.modelDescriptor` so the AI SDK image-model
 *      can read it from `providerOptions[providerId]`.
 *   3. Hand off to `canonicalGenerate` (with the mode's `requirePrompt`
 *      flag when the registry declares one).
 *
 * Vendor wire-format quirks live in the aiCore image-model adapters
 * (`aihubmix/aihubmixImageModel.ts`, `{ppio,dmxapi,ovms,modelscope}/<vendor>Transport.ts`),
 * not here. This function only does the registry → bag injection.
 */
export async function paintingGenerate(input: GenerateInput): Promise<FileMetadata[]> {
  const modelId = input.painting.model
  const canonicalMode = tabToImageGenerationMode(input.painting.mode)
  let requirePrompt: boolean | undefined
  // Threaded into canonicalGenerate so it can validate/coerce params against
  // the model's registry support + central catalog (already prefetched here).
  let support: ImageGenerationSupport | undefined
  let effectiveMode: ImageGenerationMode | undefined

  if (modelId) {
    try {
      support =
        (await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
          params: { providerId: input.provider.id, modelId }
        })) ?? undefined
      const modes = support?.modes
      effectiveMode =
        canonicalMode && modes?.[canonicalMode]
          ? canonicalMode
          : modes
            ? (Object.keys(modes)[0] as ImageGenerationMode)
            : undefined
      requirePrompt = effectiveMode && modes ? modes[effectiveMode]?.requirePrompt : undefined
    } catch (error) {
      logger.warn('Failed to prefetch vendorTransport', {
        providerId: input.provider.id,
        modelId,
        mode: canonicalMode,
        error
      })
    }
  }

  const options = {
    ...(requirePrompt !== undefined && { requirePrompt }),
    ...(support !== undefined && { support }),
    ...(effectiveMode !== undefined && { mode: effectiveMode })
  }
  return canonicalGenerate(input, Object.keys(options).length > 0 ? options : undefined)
}
