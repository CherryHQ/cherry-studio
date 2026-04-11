import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { resolveProviderApiHost, resolveProviderApiKey } from '../provider'

function createProvider(overrides: Partial<ResolvedWebSearchProvider>): ResolvedWebSearchProvider {
  return {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: ['test-key'],
    apiHost: 'https://api.example.com',
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...overrides
  }
}

describe('webSearch provider utils', () => {
  it('trims the configured API host', () => {
    const provider = createProvider({
      apiHost: '  https://api.example.com/v1  '
    })

    expect(resolveProviderApiHost(provider)).toBe('https://api.example.com/v1')
  })

  it('throws when required API keys are missing after trimming', () => {
    const provider = createProvider({
      id: 'bocha',
      apiKeys: ['  ', '\n']
    })

    expect(() => resolveProviderApiKey(provider)).toThrow('API key is required for provider bocha')
  })

  it('returns an empty API key when the provider marks it optional', () => {
    const provider = createProvider({
      id: 'exa-mcp',
      apiKeys: [' ', '']
    })

    expect(resolveProviderApiKey(provider, false)).toBe('')
  })

  it('rotates across multiple trimmed API keys for the same provider', () => {
    const provider = createProvider({
      id: 'exa',
      apiKeys: [' alpha-key ', ' beta-key ']
    })

    expect(resolveProviderApiKey(provider)).toBe('alpha-key')
    expect(resolveProviderApiKey(provider)).toBe('beta-key')
    expect(resolveProviderApiKey(provider)).toBe('alpha-key')
  })
})
