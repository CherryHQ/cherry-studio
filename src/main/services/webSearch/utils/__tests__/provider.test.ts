import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { ApiKeyRotationState, resolveProviderApiHost } from '../provider'

function createProvider(overrides: Partial<ResolvedWebSearchProvider>): ResolvedWebSearchProvider {
  return {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: ['test-key'],
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.example.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...overrides
  }
}

describe('webSearch provider utils', () => {
  it('trims the configured API host', () => {
    const provider = createProvider({
      capabilities: [{ feature: 'searchKeywords', apiHost: '  https://api.example.com/v1  ' }]
    })

    expect(resolveProviderApiHost(provider, 'searchKeywords')).toBe('https://api.example.com/v1')
  })

  it('throws when required API keys are missing after trimming', () => {
    const provider = createProvider({
      id: 'bocha',
      apiKeys: ['  ', '\n']
    })

    expect(() => new ApiKeyRotationState().resolve(provider)).toThrow('API key is required for provider bocha')
  })

  it('returns an empty API key when the provider marks it optional', () => {
    const provider = createProvider({
      id: 'exa-mcp',
      apiKeys: [' ', '']
    })

    expect(new ApiKeyRotationState().resolve(provider, false)).toBe('')
  })

  it('rotates across multiple trimmed API keys for the same provider', () => {
    const provider = createProvider({
      id: 'exa',
      apiKeys: [' alpha-key ', ' beta-key ']
    })

    const rotationState = new ApiKeyRotationState()

    expect(rotationState.resolve(provider)).toBe('alpha-key')
    expect(rotationState.resolve(provider)).toBe('beta-key')
    expect(rotationState.resolve(provider)).toBe('alpha-key')
  })

  it('clears service-owned rotation state', () => {
    const rotationState = new ApiKeyRotationState()
    const provider = createProvider({
      id: 'exa',
      apiKeys: [' alpha-key ', ' beta-key ']
    })

    expect(rotationState.resolve(provider)).toBe('alpha-key')
    expect(rotationState.resolve(provider)).toBe('beta-key')

    rotationState.clear()

    expect(rotationState.resolve(provider)).toBe('alpha-key')
  })
})
