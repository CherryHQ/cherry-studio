import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { SiliconPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultSiliconPainting } from './defaults'

// Silicon's PaintingData persists `imageSize` and `steps`; canonical AI-SDK
// param names are `imageSize` (identical) and `numInferenceSteps`. The
// fieldMap bridges only the keys that diverge — `negativePrompt`, `seed`,
// `guidanceScale`, `promptEnhancement` already match.
const SILICON_FIELD_MAP = {
  batchSize: 'numImages',
  numInferenceSteps: 'steps'
} as const

const SILICON_DEFAULTS = {
  imageSize: '1024x1024',
  batchSize: 1,
  numInferenceSteps: 25,
  guidanceScale: 4.5,
  promptEnhancement: false
}

export const siliconProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'silicon',
  dbMode: 'generate',
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('silicon')
  },
  createPaintingData: ({ modelOptions }) => createDefaultSiliconPainting(modelOptions),
  fields: [],
  useRegistryForm: true,
  registryKeyMap: { size: 'imageSize', numInferenceSteps: 'steps' },
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: (input) => canonicalGenerate(input, { fieldMap: SILICON_FIELD_MAP, defaults: SILICON_DEFAULTS })
})
