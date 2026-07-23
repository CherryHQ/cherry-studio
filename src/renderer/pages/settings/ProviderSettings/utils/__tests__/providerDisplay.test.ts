import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

// isProviderSettingsListVisibleProvider only reads the provider id; stub the i18n +
// CherryAI helpers the module imports so the test stays focused on visibility.
vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('@renderer/i18n/label', () => ({ getProviderLabelKey: (id: string) => id }))
vi.mock('@shared/utils/provider', () => ({
  isCherryAIProvider: (p: Provider) => p.id === 'cherryai',
  isLoginBasedProvider: (p: Provider) =>
    p.authMethods !== undefined && p.authMethods.length > 0 && !p.authMethods.includes('api-key')
}))

const { isProviderPresetInstanceSource, isProviderSettingsListVisibleProvider } = await import('../providerDisplay')

const provider = (id: string): Provider => ({ id }) as Provider
const presetSource = (overrides: Partial<Provider> = {}): Provider =>
  ({
    id: 'openai',
    name: 'OpenAI',
    presetProviderId: 'openai',
    authType: 'api-key',
    defaultChatEndpoint: 'openai-responses',
    endpointConfigs: {
      'openai-responses': { baseUrl: 'https://api.openai.com' }
    },
    ...overrides
  }) as Provider

describe('isProviderSettingsListVisibleProvider', () => {
  it('hides the internal local-embedding provider from the management list', () => {
    expect(isProviderSettingsListVisibleProvider(provider(LOCAL_EMBEDDING_PROVIDER_ID))).toBe(false)
  })

  it('hides the CherryAI provider', () => {
    expect(isProviderSettingsListVisibleProvider(provider('cherryai'))).toBe(false)
  })

  it('keeps a normal provider visible', () => {
    expect(isProviderSettingsListVisibleProvider(provider('openai'))).toBe(true)
  })
})

describe('isProviderPresetInstanceSource', () => {
  it('accepts a canonical URL-based preset with a configured primary endpoint', () => {
    expect(isProviderPresetInstanceSource(presetSource())).toBe(true)
  })

  it('rejects derived providers and presets without an independent generic-auth flow', () => {
    expect(isProviderPresetInstanceSource(presetSource({ id: 'openai-work' }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ authMethods: ['oauth'] }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ authType: 'iam-gcp' }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ id: 'copilot', presetProviderId: 'copilot' }))).toBe(false)
  })

  it('rejects presets without a configured default chat endpoint', () => {
    expect(isProviderPresetInstanceSource(presetSource({ defaultChatEndpoint: undefined }))).toBe(false)
    expect(isProviderPresetInstanceSource(presetSource({ endpointConfigs: undefined }))).toBe(false)
  })
})
