import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { ImageGenerationMode } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

import { canonicalGenerate } from '../model/canonicalGenerate'
import type { PaintingData } from '../model/types/paintingData'
import { loadPaintingModelOptions } from '../model/utils/paintingModelOptions'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import { createSingleModeProvider, type GenerateInput, type PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('paintings/buildPaintingProvider')

function emptyPainting(providerId: string, mode: PaintingMode = 'generate'): PaintingData {
  return { id: uuid(), providerId, mode, prompt: '', files: [], params: {} }
}

/**
 * Generic painting generate dispatch.
 *
 * Drives every provider through the same flow:
 *   1. Look up the model's `imageGeneration` block via DataApi.
 *   2. If the model declares per-mode `vendorTransport` (PPIO async endpoints,
 *      future custom-transport vendors), inject the descriptor into
 *      `painting.params.modelDescriptor` so the AI SDK image-model can read
 *      it.
 *   3. Hand off to `canonicalGenerate` with provider-derived download
 *      options (aihubmix wants the proxy-warning hint stamped on URL
 *      downloads).
 *
 * No per-vendor branches in the renderer outside this one switch on
 * `provider.id` for the download hint; the rest is registry-data driven.
 */
async function genericPaintingGenerate(input: GenerateInput): Promise<FileMetadata[]> {
  const modelId = input.painting.model
  const canonicalMode = tabToImageGenerationMode(input.painting.mode)

  if (modelId) {
    try {
      const support = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
        params: { providerId: input.provider.id, modelId }
      })
      const modes = support?.modes
      // Same fallback rule as `imageGenerationToFields`: requested mode first,
      // else first declared mode. Lets edit-only models on single-tab providers
      // still resolve to their vendorTransport.
      const effectiveMode: ImageGenerationMode | undefined =
        canonicalMode && modes?.[canonicalMode]
          ? canonicalMode
          : modes
            ? (Object.keys(modes)[0] as ImageGenerationMode)
            : undefined
      const transport = effectiveMode && modes ? modes[effectiveMode]?.vendorTransport : undefined
      if (transport?.endpoint) {
        input.painting.params = {
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

  const downloadOptions = input.provider.id === 'aihubmix' ? { showProxyWarning: true } : undefined
  return canonicalGenerate(input, downloadOptions ? { downloadOptions } : undefined)
}

/**
 * Build a `PaintingProviderDefinition` for any provider id. Returns the
 * uniform single-mode shape every consumer expects; per-vendor behavior
 * lives entirely in registry data (`imageGeneration.modes[mode].vendorTransport`,
 * provider's `paintingDefaults`) + the aiCore wire-format adapters.
 *
 * Models come from `loadPaintingModelOptions(providerId)` → DataApi
 * `/models?providerId=X` filtered by image-gen capability. No hardcoded
 * lists; no provider whitelist. A provider whose user_model rows include
 * any image-gen-tagged model auto-surfaces on the painting page.
 */
export function buildPaintingProvider(providerId: string): PaintingProviderDefinition {
  return createSingleModeProvider({
    id: providerId,
    dbMode: 'generate',
    models: { type: 'async', loader: () => loadPaintingModelOptions(providerId) },
    createPaintingData: () => emptyPainting(providerId),
    fields: [],
    onModelChange: ({ modelId }) => ({ model: modelId }),
    generate: genericPaintingGenerate
  })
}
