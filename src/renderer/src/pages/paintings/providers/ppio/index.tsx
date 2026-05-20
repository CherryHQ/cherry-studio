import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider } from '../types'
import { getModelsByMode, type PpioMode } from './config'
import { createDefaultPpioPainting } from './config'
import { ppioFields } from './fields'
import { generateWithPpioUnified } from './generateUnified'
import { getPpioPreviewSrc, handlePpioImageUpload, ppioImagePlaceholder } from './imageUpload'

export const ppioProvider = {
  id: 'ppio',
  mode: {
    tabs: [
      { value: 'ppio_draw', labelKey: 'paintings.mode.generate' },
      { value: 'ppio_edit', labelKey: 'paintings.mode.edit' }
    ],
    defaultTab: 'ppio_draw',
    tabToDbMode: (tab: string) => (tab === 'ppio_draw' ? 'draw' : 'edit'),
    // Dropdown = (user's enabled ppio image-gen models) ∩ (PPIO_MODELS routing
    // table for the current mode). PPIO_MODELS stays as the transport routing
    // index (endpoint + sync/async per modelId); only the dropdown source
    // moves to the user's actual enabled set.
    getModels: (tab: string) => ({
      type: 'async' as const,
      loader: async () => {
        const userEnabled = await loadPaintingModelOptions('ppio')
        const supportedById = new Map(getModelsByMode(tab as PpioMode).map((m) => [m.id, m]))
        return userEnabled
          .filter((opt) => supportedById.has(opt.value))
          .map((opt) => ({ ...opt, group: supportedById.get(opt.value)?.group ?? opt.group }))
      }
    }),
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
  generate: (input) => generateWithPpioUnified(input)
} satisfies PaintingProvider<PaintingData>
