import type { SiliconPaintingData as PaintingData } from '../../model/types/paintingData'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultSiliconPainting, TEXT_TO_IMAGES_MODELS } from './defaults'
import { generateWithSilicon } from './generate'

export const siliconProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'silicon',
  dbMode: 'generate',
  models: {
    type: 'static',
    options: TEXT_TO_IMAGES_MODELS.map((m) => ({ label: m.name, value: m.id }))
  },
  createPaintingData: () => createDefaultSiliconPainting(),
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
