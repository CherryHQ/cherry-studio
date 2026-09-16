import { matchVendor, normalizeModelId } from '@cherrystudio/provider-registry'
import { type IconRef, modelIconRef, providerIconRef } from '@cherrystudio/ui/icons'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getRawModelId, isNonChatModel } from '@shared/utils/model'
import { hasApiKeys, isExternalCliProvider } from '@shared/utils/provider'

export type OfficialAssistantVendor = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'kimi' | 'doubao'

const OFFICIAL_PROVIDER_IDS: Record<OfficialAssistantVendor, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  deepseek: 'deepseek',
  kimi: 'moonshot',
  doubao: 'doubao'
}

const OFFICIAL_ASSISTANT_ICONS: Record<OfficialAssistantVendor, IconRef> = {
  anthropic: modelIconRef('claude'),
  openai: providerIconRef('openai'),
  gemini: modelIconRef('gemini'),
  deepseek: modelIconRef('deepseek'),
  kimi: modelIconRef('kimi'),
  doubao: modelIconRef('doubao')
}

export type OfficialAssistantModelResolution =
  | { status: 'resolved'; modelId: UniqueModelId }
  | { status: 'configuration-required'; providerId: string }

type ResolveOfficialAssistantModelOptions = {
  vendor: OfficialAssistantVendor
  providers: readonly Provider[]
  models: readonly Model[]
  defaultModelId: string | null
}

function isProviderReady(provider: Provider) {
  if (!provider.isEnabled || isExternalCliProvider(provider)) return false
  if (provider.authOptional === true) return true

  switch (provider.authType) {
    case 'oauth':
    case 'iam-aws':
    case 'iam-gcp':
      return true
    case 'api-key':
    case 'api-key-aws':
    case 'iam-azure':
      return hasApiKeys(provider)
  }
}

function preferredTierRank(vendor: OfficialAssistantVendor, modelId: string) {
  switch (vendor) {
    case 'anthropic':
      return modelId.includes('sonnet') ? 0 : 1
    case 'openai':
      return /^gpt-5(?:-\d+)?(?:-\d{4}-\d{2}-\d{2})?(?:-chat(?:-latest)?)?$/.test(modelId) ? 0 : 1
    case 'gemini':
      return modelId.includes('pro') ? 0 : 1
    case 'deepseek':
      return modelId === 'deepseek-chat' ? 0 : 1
    case 'kimi':
      if (/^kimi-k2(?:-\d+)?(?:-\d{4}-preview)?$/.test(modelId)) return 0
      return modelId.startsWith('kimi-k2') && !modelId.includes('thinking') ? 1 : 2
    case 'doubao':
      return 0
  }
}

function getOfficialAssistantProviderId(vendor: OfficialAssistantVendor) {
  return OFFICIAL_PROVIDER_IDS[vendor]
}

export function getOfficialAssistantIconRef(vendor: OfficialAssistantVendor) {
  return OFFICIAL_ASSISTANT_ICONS[vendor]
}

export function resolveOfficialAssistantModel({
  vendor,
  providers,
  models,
  defaultModelId
}: ResolveOfficialAssistantModelOptions): OfficialAssistantModelResolution {
  const modelsByProvider = new Map<string, Model[]>()
  for (const model of models) {
    const providerModels = modelsByProvider.get(model.providerId) ?? []
    providerModels.push(model)
    modelsByProvider.set(model.providerId, providerModels)
  }

  const candidates = providers.flatMap((provider) => {
    if (!isProviderReady(provider)) return []
    return (modelsByProvider.get(provider.id) ?? []).flatMap((model) => {
      if (!model.isEnabled || model.isHidden || model.isDeprecated || isNonChatModel(model)) return []

      const canonicalModelId = normalizeModelId(model.presetModelId ?? getRawModelId(model))
      return matchVendor(canonicalModelId) === vendor ? [{ model, canonicalModelId }] : []
    })
  })

  const explicitDefault = candidates.find(({ model }) => model.id === defaultModelId)
  if (explicitDefault) return { status: 'resolved', modelId: explicitDefault.model.id }

  const preferred = candidates.reduce<(typeof candidates)[number] | undefined>((best, candidate) => {
    if (!best) return candidate
    return preferredTierRank(vendor, candidate.canonicalModelId) < preferredTierRank(vendor, best.canonicalModelId)
      ? candidate
      : best
  }, undefined)

  return preferred
    ? { status: 'resolved', modelId: preferred.model.id }
    : { status: 'configuration-required', providerId: getOfficialAssistantProviderId(vendor) }
}
