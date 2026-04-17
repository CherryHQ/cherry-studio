import { resolveProviderIcon } from '@cherrystudio/ui/icons'

import { SettingHelpLink } from '../../../settings'
import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { createSingleModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { COURSE_URL, TOP_UP_URL, ZHIPU_PAINTING_MODELS } from './config'
import { createDefaultZhipuPainting } from './defaults'
import { zhipuFields } from './fields'
import { generateWithZhipu } from './generate'

export const zhipuProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'zhipu',
  dbMode: 'generate',
  models: {
    type: 'static',
    options: ZHIPU_PAINTING_MODELS.map((m) => ({ label: m.name, value: m.id }))
  },
  createPaintingData: () => createDefaultZhipuPainting(),
  fields: zhipuFields,
  onModelChange: ({ modelId }) => ({ model: modelId }),
  slots: {
    headerExtra: (provider, t) => {
      const Icon = resolveProviderIcon(provider.id)
      return (
        <>
          <SettingHelpLink target="_blank" href={TOP_UP_URL}>
            {t('paintings.top_up')}
          </SettingHelpLink>
          <SettingHelpLink target="_blank" href={COURSE_URL}>
            {t('paintings.paint_course')}
          </SettingHelpLink>
          {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
        </>
      )
    }
  },
  generate: (ctx: GenerateContext) => generateWithZhipu(ctx)
})
