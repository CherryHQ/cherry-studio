import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'
import { createMultiModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { getModelsByMode, type PpioMode } from './config'
import { createDefaultPpioPainting } from './defaults'
import { ppioFields } from './fields'
import { generateWithPpio } from './generate'

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
  prompt: {
    translateShortcut: true
  },
  generate: (ctx: GenerateContext) => generateWithPpio(ctx)
})
