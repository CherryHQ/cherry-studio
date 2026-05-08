import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'
import { createMultiModeProvider, type PaintingProviderDefinition } from '../types'
import { getModelsByMode, type PpioMode } from './config'
import { createDefaultPpioPainting } from './config'
import { ppioFields } from './fields'
import { generateWithPpio } from './generate'
import { getPpioPreviewSrc, handlePpioImageUpload, ppioImagePlaceholder } from './imageUpload'

export const ppioProvider: PaintingProviderDefinition = createMultiModeProvider<PaintingData>({
  id: 'ppio',
  mode: {
    tabs: [
      { value: 'ppio_draw', labelKey: 'paintings.mode.generate' },
      { value: 'ppio_edit', labelKey: 'paintings.mode.edit' }
    ],
    defaultTab: 'ppio_draw',
    tabToDbMode: (tab: string) => (tab === 'ppio_draw' ? 'draw' : 'edit'),
    getModels: (tab: string) => {
      const models = getModelsByMode(tab as PpioMode)
      return {
        type: 'static' as const,
        options: models.map((m) => ({ label: m.name, value: m.id, group: m.group }))
      }
    },
    createPaintingData: ({ tab }) => createDefaultPpioPainting(tab)
  },
  fields: {
    byTab: ppioFields,
    onModelChange: ({ modelId }) => ({ model: modelId }) as Partial<PaintingData>
  },
  image: {
    onUpload: ({ key, file, patchPainting }) => handlePpioImageUpload(key, file, patchPainting),
    getPreviewSrc: ({ key, painting }) => getPpioPreviewSrc(key, painting),
    placeholder: ppioImagePlaceholder
  },
  generate: generateWithPpio
})
