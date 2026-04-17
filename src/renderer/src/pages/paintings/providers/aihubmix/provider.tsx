import { resolveProviderIcon } from '@cherrystudio/ui/icons'

import { SettingHelpLink } from '../../../settings'
import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { createMultiModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { createDefaultAihubmixPainting } from './defaults'
import { aihubmixFields, getStaticModelsForAihubmixMode } from './fields'
import { generateWithAihubmix } from './generate'
import { aihubmixImagePlaceholder, getAihubmixPreviewSrc, handleAihubmixImageUpload } from './imageUpload'

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
    translateShortcut: true,
    placeholder: ({ painting, t, isTranslating }) => {
      if (isTranslating) return t('paintings.translating')
      if (painting.model?.startsWith('imagen-') || painting.model?.startsWith('FLUX')) {
        return t('paintings.prompt_placeholder_en')
      }
      return t('paintings.prompt_placeholder_edit')
    }
  },
  image: {
    onUpload: ({ key, file, patchPainting }) => handleAihubmixImageUpload(key, file, patchPainting),
    getPreviewSrc: ({ key, painting }) => getAihubmixPreviewSrc(key, painting),
    placeholder: aihubmixImagePlaceholder
  },
  slots: {
    headerExtra: (provider, t) => {
      const Icon = resolveProviderIcon('aihubmix')
      return (
        <SettingHelpLink target="_blank" href={provider.apiHost}>
          {t('paintings.learn_more')}
          {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
        </SettingHelpLink>
      )
    }
  },
  generate: (ctx: GenerateContext) => generateWithAihubmix(ctx)
})
