import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { PROVIDER_URLS } from '@renderer/config/providers'
import i18n from '@renderer/i18n'
import { uuid } from '@renderer/utils'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createMultiModeProvider, type PaintingProviderDefinition } from '../types'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from './config'
import { newApiFields } from './fields'
import { generateWithNewApi } from './generate'

export function NewApiHeaderActions({ provider, t }: { provider: PaintingProviderRuntime; t: TFunction }) {
  const Icon = resolveProviderIcon(provider.id)
  return (
    <SettingHelpLink
      target="_blank"
      href={
        PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS]?.websites?.docs ||
        'https://docs.newapi.pro/apps/cherry-studio/'
      }>
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="shrink-0" /> : null}
    </SettingHelpLink>
  )
}

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
  return createMultiModeProvider<PaintingData>({
    id: providerId,
    mode: {
      tabs: [
        { value: 'generate', labelKey: 'paintings.mode.generate' },
        { value: 'edit', labelKey: 'paintings.mode.edit' }
      ],
      defaultTab: 'generate',
      tabToDbMode: (tab: string) => tab as any,
      getModels: () => ({
        type: 'async',
        loader: async () =>
          (await loadPaintingModelOptions(providerId)).map((option) => ({
            ...option,
            custom: !SUPPORTED_MODELS.includes(option.value)
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
    generate: (input) => generateWithNewApi(input)
  })
}

export { NewApiSetting } from './sidebar'
