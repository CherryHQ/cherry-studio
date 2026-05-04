import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { ZhipuPaintingData as PaintingData } from '../../model/types/paintingData'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { COURSE_URL, TOP_UP_URL, ZHIPU_PAINTING_MODELS } from './config'
import { createDefaultZhipuPainting } from './defaults'
import { zhipuFields } from './fields'
import { generateWithZhipu } from './generate'

export function ZhipuHeaderActions({ t }: { t: TFunction }) {
  const Icon = resolveProviderIcon('zhipu')
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
  generate: generateWithZhipu
})
