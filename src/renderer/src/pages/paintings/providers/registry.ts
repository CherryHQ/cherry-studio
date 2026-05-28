import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'

import { canonicalGenerate } from '../model/canonicalGenerate'
import type { PaintingData } from '../model/types/paintingData'
import { loadPaintingModelOptions } from '../model/utils/paintingModelOptions'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import { createSingleModeProvider, type GenerateInput, type PaintingProviderDefinition } from './shared/provider'
import { tokenFluxProvider } from './tokenflux'

const logger = loggerService.withContext('paintings/registry')

function emptyPainting(providerId: string, mode: PaintingMode = 'generate'): PaintingData {
  return { id: uuid(), providerId, mode, prompt: '', files: [], params: {} }
}

const siliconProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'silicon',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('silicon') },
  createPaintingData: () => emptyPainting('silicon'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input)
})

const zhipuProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'zhipu',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('zhipu') },
  createPaintingData: () => emptyPainting('zhipu'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input)
})

const ovmsProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'ovms',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('ovms') },
  createPaintingData: () => emptyPainting('ovms'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input)
})

const aihubmixProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'aihubmix',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('aihubmix') },
  createPaintingData: () => emptyPainting('aihubmix'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input, { downloadOptions: { showProxyWarning: true } })
})

const dmxapiProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'dmxapi',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('dmxapi') },
  createPaintingData: () => emptyPainting('dmxapi'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input)
})

/**
 * PPIO's image transport (`aiCore/provider/custom/imageTransports/ppio.ts`)
 * dispatches by `providerOptions.ppio.modelDescriptor.{endpoint,isSync}`.
 * Registry's per-mode `vendorTransport: { endpoint, isSync }` is the source
 * of truth (21 PPIO image-gen models populated in models.json). Inject the
 * descriptor into `painting.params.modelDescriptor` before canonicalGenerate
 * so it flows to the bag via the generic partition.
 */
async function ppioGenerate(input: GenerateInput): Promise<FileMetadata[]> {
  const modelId = input.painting.model
  const canonicalMode = tabToImageGenerationMode(input.painting.mode)
  if (modelId) {
    try {
      const support = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
        params: { providerId: 'ppio', modelId }
      })
      const modes = support?.modes
      // Edit-only models (qwen-image-edit, image-upscaler, image-eraser,
      // seedream-4.0-edit, …) declare only `modes.edit`; their vendorTransport
      // lives there, not on `modes.generate`. Pick the effective mode: prefer
      // what painting.mode resolves to; otherwise fall back to the model's
      // first declared mode. The fallback mode is also stamped on the
      // descriptor so PpioTransport's `buildSeedreamParams` branches by edit
      // vs draw correctly.
      const effectiveMode =
        canonicalMode && modes?.[canonicalMode]
          ? canonicalMode
          : modes
            ? (Object.keys(modes)[0] as keyof typeof modes)
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
      logger.warn('Failed to prefetch PPIO vendorTransport', { modelId, mode: canonicalMode, error })
    }
  }
  return canonicalGenerate(input)
}

const ppioProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'ppio',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('ppio') },
  createPaintingData: () => emptyPainting('ppio'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: ppioGenerate
})

/**
 * OpenAI-compatible image generation providers (new-api / cherryin / aionly +
 * any user-added new-api preset). Built inline rather than via factory: shape
 * is identical except for the `id`. Resolved by `paintingProviderMode.ts`
 * fallback path for ids absent from the static table.
 */
export function buildOpenAiCompatibleProvider(providerId: string): PaintingProviderDefinition {
  return createSingleModeProvider({
    id: providerId,
    dbMode: 'generate',
    models: { type: 'async', loader: () => loadPaintingModelOptions(providerId) },
    createPaintingData: () => emptyPainting(providerId),
    fields: [],
    onModelChange: ({ modelId }) => ({ model: modelId }),
    generate: (input) => canonicalGenerate(input)
  })
}

const NEWAPI_COMPAT_IDS = ['new-api', 'cherryin', 'aionly'] as const

export const providerRegistry: Record<string, PaintingProviderDefinition> = {
  silicon: siliconProvider,
  zhipu: zhipuProvider,
  ovms: ovmsProvider,
  aihubmix: aihubmixProvider,
  dmxapi: dmxapiProvider,
  ppio: ppioProvider,
  tokenflux: tokenFluxProvider,
  ...Object.fromEntries(NEWAPI_COMPAT_IDS.map((id) => [id, buildOpenAiCompatibleProvider(id)]))
}
