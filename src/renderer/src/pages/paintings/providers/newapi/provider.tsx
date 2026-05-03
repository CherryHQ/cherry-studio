import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../../settings'
import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { createMultiModeProvider, type PaintingProviderDefinition } from '../types'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from './config'
import { newApiFields } from './fields'
import { generateWithNewApi } from './generate'
import { renderNewApiSidebarExtra } from './sidebar'

function getModelOptions(provider: {
  models: Array<{
    id: string
    name: string
    endpoint_type?: string
    supported_endpoint_types?: string[]
    group?: string
  }>
}) {
  return provider.models
    .filter(
      (model) =>
        model.endpoint_type === 'image-generation' || model.supported_endpoint_types?.includes('image-generation')
    )
    .map((model) => ({
      label: model.name,
      value: model.id,
      custom: !SUPPORTED_MODELS.includes(model.id),
      group: model.group || ''
    }))
}

function getModelDefaults(modelId: string) {
  const modelConfig = MODELS.find((model) => model.name === modelId)
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
        type: 'dynamic',
        resolver: (provider) => getModelOptions(provider as any)
      }),
      createPaintingData: ({ modelOptions }) => ({
        ...DEFAULT_PAINTING,
        id: uuid(),
        model: modelOptions?.[0]?.value || '',
        providerId
      })
    },
    fields: {
      byTab: newApiFields,
      onModelChange: ({ modelId }) => getModelDefaults(modelId)
    },
    prompt: {
      translateShortcut: true,
      placeholder: ({ painting, t, isTranslating }) => {
        if (isTranslating) return t('paintings.translating')
        if (painting.model?.startsWith('imagen-')) return t('paintings.prompt_placeholder_en')
        return t('paintings.prompt_placeholder_edit')
      }
    },
    slots: {
      headerExtra: (provider, t) => {
        const Icon = resolveProviderIcon(provider.id)
        return (
          <SettingHelpLink
            target="_blank"
            href={
              PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS]?.websites?.docs ||
              'https://docs.newapi.pro/apps/cherry-studio/'
            }>
            {t('paintings.learn_more')}
            {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
          </SettingHelpLink>
        )
      },
      sidebarExtra: (state) => renderNewApiSidebarExtra(providerId, state)
    },
    generate: (ctx) => generateWithNewApi(ctx)
  })
}
