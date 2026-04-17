import { resolveProviderIcon } from '@cherrystudio/ui/icons'

import { SettingHelpLink } from '../../../settings'
import type { OvmsPaintingData as PaintingData } from '../../model/types/paintingData'
import { createSingleModeProvider, type GenerateContext, type PaintingProviderDefinition } from '../types'
import { getOvmsModels, OVMS_MODELS } from './config'
import { createDefaultOvmsProviderPainting } from './defaults'
import { createOvmsFields } from './fields'
import { generateWithOvms } from './generate'

export const ovmsProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'ovms',
  dbMode: 'generate',
  models: {
    type: 'dynamic',
    resolver: (provider) => getOvmsModels(provider.models)
  },
  createPaintingData: ({ modelOptions }) => createDefaultOvmsProviderPainting(modelOptions),
  fields: createOvmsFields(),
  onModelChange: ({ modelId }) => ({ model: modelId }),
  prompt: {
    disabled: ({ painting, isLoading }) => isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value
  },
  slots: {
    headerExtra: (_provider, t) => {
      const Icon = resolveProviderIcon('ovms')
      return (
        <SettingHelpLink
          target="_blank"
          href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
          {t('paintings.learn_more')}
          {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
        </SettingHelpLink>
      )
    }
  },
  generate: (ctx: GenerateContext) => generateWithOvms(ctx)
})
