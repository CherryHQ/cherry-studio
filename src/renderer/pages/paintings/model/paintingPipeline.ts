import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { ImageGenerationMode } from '@shared/data/types/model'

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
  // Local params copy threaded to canonicalGenerate — never reassign
  // `input.painting.params`, or the synthetic `modelDescriptor` leaks into
  // the live in-memory draft and re-emits on regenerate.
  let paramsForGenerate = input.painting.params

  if (modelId) {
    try {
      const support = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
        params: { providerId: input.provider.id, modelId }
      })
      const modes = support?.modes
      const effectiveMode: ImageGenerationMode | undefined =
        canonicalMode && modes?.[canonicalMode]
          ? canonicalMode
          : modes
            ? (Object.keys(modes)[0] as ImageGenerationMode)
            : undefined
      const modeDef = effectiveMode && modes ? modes[effectiveMode] : undefined
      const transport = modeDef?.vendorTransport
      requirePrompt = modeDef?.requirePrompt
      if (transport?.endpoint) {
        paramsForGenerate = {
          ...input.painting.params,
          modelDescriptor: {
            id: modelId,
            endpoint: transport.endpoint,
            isSync: transport.isSync,
            mode: effectiveMode
          }
        }
      }
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
    ...(requirePrompt !== undefined && { requirePrompt })
  }
  const generateInput: GenerateInput =
    paramsForGenerate === input.painting.params
      ? input
      : { ...input, painting: { ...input.painting, params: paramsForGenerate } }
  return canonicalGenerate(generateInput, Object.keys(options).length > 0 ? options : undefined)
}
