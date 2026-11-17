import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { isAIGatewayProvider, isSupportAnthropicPromptCacheProvider } from '@shared/utils/provider'

function provider(overrides: Partial<Provider>): Provider {
  return { id: 'gateway', settings: {}, ...overrides } as Provider
}

describe('Vercel AI Gateway prompt caching capability', () => {
  it('counts the built-in gateway provider as cache capable', () => {
    expect(isSupportAnthropicPromptCacheProvider(provider({ id: 'gateway' }))).toBe(true)
    expect(isAIGatewayProvider(provider({ id: 'gateway' }))).toBe(true)
  })

  it('leaves other OpenAI-dialect providers on their existing path', () => {
    expect(isSupportAnthropicPromptCacheProvider(provider({ id: 'openai', presetProviderId: 'openai' }))).toBe(false)
    expect(isAIGatewayProvider(provider({ id: 'deepseek', presetProviderId: 'deepseek' }))).toBe(false)
  })
})
