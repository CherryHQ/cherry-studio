import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { PROVIDER_URLS } from '@renderer/config/providers'
import i18n from '@renderer/i18n'
import { uuid } from '@renderer/utils'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import type { PaintingProvider, PaintingProviderDefinition } from '../types'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from './config'
import { newApiFields } from './fields'
import { generateWithNewApi } from './generate'
import { generateWithNewApiUnified } from './generateUnified'

/**
 * Bespoke direct-fetch → AI-SDK-native switch, keyed by painting provider id.
 *
 * new-api, aionly, and cherryin are cut over to the unified files-driven
 * path (`generateWithNewApiUnified`). cherryin routes through
 * `buildCherryinConfig` → `createCherryIn`'s native `OpenAIImageModel` at
 * `https://open.cherryin.net/v1/images/generations` with `Bearer <key>` — the
 * exact endpoint and auth the bespoke path sent. For `gpt-image-1` (the only
 * SUPPORTED_MODEL) the request body is byte-equivalent (size omitted on
 * `'auto'` via R2 `allowAutoSize`, quality/background/moderation forwarded
 * under `providerOptions.openai`).
 *
 * Bespoke `generateWithNewApi` is retained as the fallback for custom user
 * providers with `presetProviderId === 'new-api'` (their `providerId` is the
 * user's custom id, never in this set); the unified path's
 * `buildOpenAICompatibleConfig` resolution for those ids has not been
 * parity-checked.
 */
const UNIFIED_NEWAPI_PROVIDERS = new Set<string>(['new-api', 'aionly', 'cherryin'])

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
    generate: (input) =>
      UNIFIED_NEWAPI_PROVIDERS.has(providerId) ? generateWithNewApiUnified(input) : generateWithNewApi(input)
  } satisfies PaintingProvider<PaintingData>

  return provider
}

export { NewApiSetting } from './sidebar'
