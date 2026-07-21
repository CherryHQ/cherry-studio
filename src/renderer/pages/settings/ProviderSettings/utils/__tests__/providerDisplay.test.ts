import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

// isProviderSettingsListVisibleProvider only reads the provider id; stub the i18n +
// CherryAI helpers the module imports so the test stays focused on visibility.
vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('@renderer/i18n/label', () => ({ getProviderLabelKey: (id: string) => id }))
vi.mock('@shared/utils/provider', () => ({ isCherryAIProvider: (p: Provider) => p.id === 'cherryai' }))

const { isProviderSettingsListVisibleProvider } = await import('../providerDisplay')

const provider = (id: string): Provider => ({ id }) as Provider

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
