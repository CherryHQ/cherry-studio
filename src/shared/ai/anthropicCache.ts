import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export const ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD = 1024
export const ANTHROPIC_CACHE_HAIKU_TOKEN_THRESHOLD = 2048
export const ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES = 2

export interface EffectiveAnthropicCacheSettings {
  enabled: boolean
  tokenThreshold: number
  cacheSystemMessage: boolean
  cacheLastNMessages: number
  cacheToolDefinitions: boolean
}

export function getAnthropicCacheMinimumTokenThreshold(model: Pick<Model, 'id' | 'name' | 'apiModelId'>): number {
  const id = `${model.id} ${model.name} ${model.apiModelId ?? ''}`.toLowerCase()
  return id.includes('haiku') ? ANTHROPIC_CACHE_HAIKU_TOKEN_THRESHOLD : ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD
}

export function resolveAnthropicCacheSettings(
  provider: Pick<Provider, 'settings'>,
  model: Pick<Model, 'id' | 'name' | 'apiModelId'>
): EffectiveAnthropicCacheSettings {
  const settings = provider.settings?.cacheControl
  if (settings?.enabled === false) {
    return {
      enabled: false,
      tokenThreshold: getAnthropicCacheMinimumTokenThreshold(model),
      cacheSystemMessage: settings.cacheSystemMessage ?? true,
      cacheLastNMessages: settings.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
      cacheToolDefinitions: true
    }
  }

  const minimum = getAnthropicCacheMinimumTokenThreshold(model)
  return {
    enabled: true,
    tokenThreshold: Math.max(settings?.tokenThreshold ?? ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD, minimum),
    cacheSystemMessage: settings?.cacheSystemMessage ?? true,
    cacheLastNMessages: settings?.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
    cacheToolDefinitions: true
  }
}
