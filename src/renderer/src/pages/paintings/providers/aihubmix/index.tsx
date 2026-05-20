import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import i18n from '@renderer/i18n'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { AihubmixPaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider } from '../types'
import { createDefaultAihubmixPainting } from './defaults'
import { generateWithAihubmixUnified } from './generateUnified'
import { aihubmixImagePlaceholder, getAihubmixPreviewSrc, handleAihubmixImageUpload } from './imageUpload'
import { getStaticModelsForAihubmixMode } from './models'

export function AihubmixHeaderActions({ provider, t }: { provider: PaintingProviderRuntime; t: TFunction }) {
  const Icon = resolveProviderIcon('aihubmix')
  return (
    <SettingHelpLink target="_blank" href={provider.apiHost}>
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="shrink-0" /> : null}
    </SettingHelpLink>
  )
}

export const aihubmixProvider = {
  id: 'aihubmix',
  mode: {
    tabs: [
      { value: 'generate', labelKey: 'paintings.mode.generate' },
      { value: 'remix', labelKey: 'paintings.mode.remix' },
      { value: 'upscale', labelKey: 'paintings.mode.upscale' }
    ],
    defaultTab: 'generate',
    tabToDbMode: (tab: string) => tab,
    // Dropdown = (user's enabled aihubmix image-gen models) ∩ (aihubmix's per-tab
    // transport whitelist). The static list is now strictly a transport routing
    // hint, not the source of "what the user can pick" — that's their actual
    // enabled model set.
    getModels: (tab: string) => ({
      type: 'async' as const,
      loader: async () => {
        const userEnabled = await loadPaintingModelOptions('aihubmix')
        const supported = new Set(
          getStaticModelsForAihubmixMode(tab as 'generate' | 'remix' | 'upscale').map((m) => m.value)
        )
        return userEnabled.filter((opt) => supported.has(opt.value))
      }
    }),
    createPaintingData: ({ tab }) => createDefaultAihubmixPainting(tab)
  },
  // Field list comes from the registry's per-model `imageGeneration`
  // block (see packages/provider-registry/data/models.json). The
  // per-model `keyMap` aliases canonical keys (numImages, size,
  // imageResolution) to the legacy persisted field names (n,
  // numberOfImages, aspectRatio, imageSize) so existing PaintingData
  // shape is preserved.
  useRegistryForm: true,
  fields: {
    byTab: {},
    onModelChange: ({ modelId }) => ({ model: modelId })
  },
  prompt: {
    placeholder: ({ painting }) => {
      if (painting.model?.startsWith('imagen-') || painting.model?.startsWith('FLUX')) {
        return i18n.t('paintings.prompt_placeholder_en')
      }
      return i18n.t('paintings.prompt_placeholder_edit')
    }
  },
  image: {
    onUpload: ({ key, file, patchPainting, painting }) =>
      handleAihubmixImageUpload(key, file, patchPainting, getAihubmixPreviewSrc(key, painting ?? ({} as PaintingData))),
    getPreviewSrc: ({ key, painting }) => getAihubmixPreviewSrc(key, painting),
    placeholder: aihubmixImagePlaceholder
  },
  generate: (input) => generateWithAihubmixUnified(input)
} satisfies PaintingProvider<PaintingData>
