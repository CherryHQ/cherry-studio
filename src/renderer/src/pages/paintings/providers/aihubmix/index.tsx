import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import i18n from '@renderer/i18n'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { AihubmixPaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { createMultiModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultAihubmixPainting } from './config'
import { aihubmixFields, getStaticModelsForAihubmixMode } from './fields'
import { generateWithAihubmix } from './generate'
import { aihubmixImagePlaceholder, getAihubmixPreviewSrc, handleAihubmixImageUpload } from './imageUpload'

export function AihubmixHeaderActions({ provider, t }: { provider: PaintingProviderRuntime; t: TFunction }) {
  const Icon = resolveProviderIcon('aihubmix')
  return (
    <SettingHelpLink target="_blank" href={provider.apiHost}>
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="shrink-0" /> : null}
    </SettingHelpLink>
  )
}

export const aihubmixProvider: PaintingProviderDefinition = createMultiModeProvider<PaintingData>({
  id: 'aihubmix',
  mode: {
    tabs: [
      { value: 'generate', labelKey: 'paintings.mode.generate' },
      { value: 'remix', labelKey: 'paintings.mode.remix' },
      { value: 'upscale', labelKey: 'paintings.mode.upscale' }
    ],
    defaultTab: 'generate',
    tabToDbMode: (tab: string) => tab as any,
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
    onUpload: ({ key, file, patchPainting }) => handleAihubmixImageUpload(key, file, patchPainting),
    getPreviewSrc: ({ key, painting }) => getAihubmixPreviewSrc(key, painting),
    placeholder: aihubmixImagePlaceholder
  },
  generate: (input) => generateWithAihubmix(input)
})
