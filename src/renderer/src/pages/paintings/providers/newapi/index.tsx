import i18n from '@renderer/i18n'
import { uuid } from '@renderer/utils'

import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider, PaintingProviderDefinition } from '../types'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from './config'
import { newApiFields } from './fields'
import { generateWithNewApiUnified } from './generateUnified'

function getModelDefaults(modelId: string) {
  const modelConfig = MODELS.find((model) => model.name === modelId) ?? MODELS[0]
  const updates: Partial<PaintingData> = { model: modelId, n: 1 }

  if (modelConfig?.imageSizes?.length) {
    updates.size = modelConfig.imageSizes[0].value
  }

  if (modelConfig?.quality?.length) {
    updates.quality = modelConfig.quality[0].value
  }

  if (modelConfig?.moderation?.length) {
    updates.moderation = modelConfig.moderation[0].value
  }

  return updates
}

export function createNewApiProvider(providerId: string): PaintingProviderDefinition {
  const provider = {
    id: providerId,
    mode: {
      tabs: [
        { value: 'generate', labelKey: 'paintings.mode.generate' },
        { value: 'edit', labelKey: 'paintings.mode.edit' }
      ],
      defaultTab: 'generate',
      tabToDbMode: (tab: string) => tab,
      getModels: () => ({
        type: 'async',
        loader: async () =>
          (await loadPaintingModelOptions(providerId)).map((option) => ({
            ...option,
            meta: { ...option.meta, custom: !SUPPORTED_MODELS.includes(option.value) }
          }))
      }),
      createPaintingData: ({ modelOptions, tab }) => ({
        ...DEFAULT_PAINTING,
        id: uuid(),
        providerId,
        mode: tab === 'edit' ? 'edit' : 'generate',
        model: modelOptions?.[0]?.value || ''
      })
    },
    fields: {
      byTab: newApiFields,
      onModelChange: ({ modelId }) => getModelDefaults(modelId)
    },
    prompt: {
      placeholder: ({ painting }) => {
        if (painting.model?.startsWith('imagen-')) return i18n.t('paintings.prompt_placeholder_en')
        return i18n.t('paintings.prompt_placeholder_edit')
      }
    },
    generate: (input) => generateWithNewApiUnified(input)
  } satisfies PaintingProvider<PaintingData>

  return provider
}

export { NewApiSetting } from './sidebar'
