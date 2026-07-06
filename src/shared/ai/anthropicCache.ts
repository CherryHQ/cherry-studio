import type { Provider } from '@shared/data/types/provider'

// This is Cherry's local marker-placement default, not Anthropic's model-specific minimum.
// Anthropic owns the real cacheability rules and reports actual read/write usage; keeping
// a local model threshold table here would go stale across new models and compatible gateways.
export const ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD = 1024
export const ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES = 2

export interface EffectiveAnthropicCacheSettings {
  enabled: boolean
  tokenThreshold: number
  cacheSystemMessage: boolean
  cacheLastNMessages: number
}

export function resolveAnthropicCacheSettings(provider: Pick<Provider, 'settings'>): EffectiveAnthropicCacheSettings {
  const settings = provider.settings?.cacheControl
  const tokenThreshold = settings?.tokenThreshold ?? ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD

  return {
    // v1 used tokenThreshold: 0 as the off switch and migrated providers can still carry that shape.
    enabled: settings?.enabled !== false && tokenThreshold > 0,
    tokenThreshold,
    cacheSystemMessage: settings?.cacheSystemMessage ?? true,
    cacheLastNMessages: settings?.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES
  }
}
