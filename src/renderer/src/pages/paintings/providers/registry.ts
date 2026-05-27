import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'

import { canonicalGenerate } from '../model/canonicalGenerate'
import type { PaintingData } from '../model/types/paintingData'
import { loadPaintingModelOptions } from '../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from './shared/provider'
import { tokenFluxProvider } from './tokenflux'

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

const ppioProvider: PaintingProviderDefinition = createSingleModeProvider({
  id: 'ppio',
  dbMode: 'generate',
  models: { type: 'async', loader: () => loadPaintingModelOptions('ppio') },
  createPaintingData: () => emptyPainting('ppio'),
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input)
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
