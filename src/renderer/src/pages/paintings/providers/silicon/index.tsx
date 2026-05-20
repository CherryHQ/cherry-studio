import type { SiliconPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultSiliconPainting } from './defaults'
import { generateWithSilicon } from './generate'

export const siliconProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'silicon',
  dbMode: 'generate',
  // Model list is the user's enabled image-gen models for silicon (DataApi
  // GET /models filtered by `supportsImageGenerationEndpoint`). The painting
  // page does not preselect or seed any models — if the user has none enabled,
  // the dropdown is empty by design.
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('silicon')
  },
  createPaintingData: ({ modelOptions }) => createDefaultSiliconPainting(modelOptions),
  // Silicon derives its painting form from the registry `imageGeneration`
  // block on each model. The keyMap aliases canonical `size` /
  // `numInferenceSteps` to silicon's legacy persisted field names so existing
  // user paintings keep working without a data migration.
  fields: [],
  useRegistryForm: true,
  registryKeyMap: { size: 'imageSize', numInferenceSteps: 'steps' },
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: generateWithSilicon
})
