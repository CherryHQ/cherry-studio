import type { SiliconPaintingData as PaintingData } from '../../model/types/paintingData'
import { createSingleModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { createDefaultSiliconPainting, TEXT_TO_IMAGES_MODELS } from './defaults'
import { siliconFields } from './fields'
import { generateWithSilicon } from './generate'

export const siliconProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'silicon',
  dbMode: 'generate',
  models: {
    type: 'static',
    options: TEXT_TO_IMAGES_MODELS.map((m) => ({ label: m.name, value: m.id }))
  },
  createPaintingData: () => createDefaultSiliconPainting(),
  fields: siliconFields,
  onModelChange: ({ modelId }) => ({ model: modelId }),
  prompt: {
    translateShortcut: true
  },
  generate: (ctx: GenerateContext) => generateWithSilicon(ctx)
})
