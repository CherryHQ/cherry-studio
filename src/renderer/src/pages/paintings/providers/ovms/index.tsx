import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { OvmsPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultOvmsPainting, OVMS_MODELS } from './config'
import { createOvmsFields } from './fields'
import { generateWithOvms } from './generate'

export function OvmsHeaderActions({ t }: { t: TFunction }) {
  const Icon = resolveProviderIcon('ovms')
  return (
    <SettingHelpLink target="_blank" href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null}
    </SettingHelpLink>
  )
}

export const ovmsProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'ovms',
  dbMode: 'generate',
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('ovms')
  },
  createPaintingData: ({ modelOptions }) => createDefaultOvmsPainting(modelOptions),
  fields: createOvmsFields(),
  onModelChange: ({ modelId }) => ({ model: modelId }),
  prompt: {
    disabled: ({ painting, isLoading }) => isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value
  },
  generate: generateWithOvms
})
