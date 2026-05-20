import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider } from '../types'
import { createDefaultPpioPainting } from './defaults'
import { generateWithPpioUnified } from './generateUnified'
import { getPpioPreviewSrc, handlePpioImageUpload, ppioImagePlaceholder } from './imageUpload'
import { getModelsByMode, type PpioMode } from './models'

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
  // Field list comes from the registry's per-model `imageGeneration`
  // block (see packages/provider-registry/data/models.json). Per-model
  // keyMap aliases canonical keys to legacy field names — `seed` →
  // `ppioSeed`, `promptEnhancement` → `usePreLlm`, `imageResolution`
  // → `resolution` — so existing PaintingData shape stays intact.
  useRegistryForm: true,
  fields: {
    byTab: {},
    onModelChange: ({ modelId }) => ({ model: modelId }) as Partial<PaintingData>
  },
  image: {
    onUpload: ({ key, file, patchPainting }) => handlePpioImageUpload(key, file, patchPainting),
    getPreviewSrc: ({ key, painting }) => getPpioPreviewSrc(key, painting),
    placeholder: ppioImagePlaceholder
  },
  generate: (input) => generateWithPpioUnified(input)
} satisfies PaintingProvider<PaintingData>
