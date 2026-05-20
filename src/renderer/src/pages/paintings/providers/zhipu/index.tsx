import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { ZhipuPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { COURSE_URL, createDefaultZhipuPainting, TOP_UP_URL } from './config'
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
      {Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null}
    </>
  )
}

export const zhipuProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'zhipu',
  dbMode: 'generate',
  // Model list is the user's enabled image-gen models for zhipu (DataApi
  // GET /models filtered by `supportsImageGenerationEndpoint`). The painting
  // page does not preselect or seed any models — if the user has none enabled,
  // the dropdown is empty by design.
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('zhipu')
  },
  createPaintingData: ({ modelOptions }) => createDefaultZhipuPainting(modelOptions),
  fields: zhipuFields,
  onModelChange: ({ modelId }) => ({ model: modelId }),
  generate: generateWithZhipu
})
