import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import i18n from '@renderer/i18n'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { AihubmixPaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import type { PaintingProvider } from '../types'
import { createDefaultAihubmixPainting } from './config'
import { aihubmixFields, getStaticModelsForAihubmixMode } from './fields'
import { generateWithAihubmix } from './generate'
import { generateWithAihubmixUnified } from './generateUnified'
import { aihubmixImagePlaceholder, getAihubmixPreviewSrc, handleAihubmixImageUpload } from './imageUpload'
import { UNIFIED_SINGLESHOT_PROVIDERS } from '../dmxapi/index'

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
    getModels: (tab: string) => ({
      type: 'static' as const,
      options: getStaticModelsForAihubmixMode(tab as 'generate' | 'remix' | 'upscale')
    }),
    createPaintingData: ({ tab }) => createDefaultAihubmixPainting(tab)
  },
  fields: {
    byTab: aihubmixFields,
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
  generate: (input) =>
    UNIFIED_SINGLESHOT_PROVIDERS.has('aihubmix') ? generateWithAihubmixUnified(input) : generateWithAihubmix(input)
} satisfies PaintingProvider<PaintingData>
