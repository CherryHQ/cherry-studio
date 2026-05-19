import type { PpioPaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProvider } from '../types'
import { getModelsByMode, type PpioMode } from './config'
import { createDefaultPpioPainting } from './config'
import { ppioFields } from './fields'
import { generateWithPpio } from './generate'
import { generateWithPpioUnified } from './generateUnified'
import { getPpioPreviewSrc, handlePpioImageUpload, ppioImagePlaceholder } from './imageUpload'

/**
 * Bespoke direct-fetch → AI-SDK-native `PollingImageModel` switch, keyed by
 * painting provider id (ppio / tokenflux).
 *
 * EMPTY by default: every polling provider keeps its legacy bespoke path
 * (`generateWithPpio` / `generateWithTokenFlux`), so runtime behavior is
 * unchanged (zero regression). The unified path is wired and type-checked but
 * opt-in — add a provider id here only after manual verification, and remove
 * it to roll back. Bespoke `generate.ts`/`service.ts` stay until Phase 4.
 */
export const UNIFIED_POLLING_PROVIDERS = new Set<string>([])

export const ppioProvider = {
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
  generate: (input) =>
    UNIFIED_POLLING_PROVIDERS.has('ppio') ? generateWithPpioUnified(input) : generateWithPpio(input)
} satisfies PaintingProvider<PaintingData>
