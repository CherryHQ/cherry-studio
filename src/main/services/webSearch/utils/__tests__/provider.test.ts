import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { WebSearchConfigError } from '../../WebSearchConfigError'
import { ApiKeyRotationState, resolveProviderApiHost } from '../provider'

function createProvider(overrides: Partial<WebSearchProvider>): WebSearchProvider {
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

  it('throws when the required API host is missing after trimming', () => {
    const provider = createProvider({
      capabilities: [{ feature: 'searchKeywords', apiHost: '  ' }]
    })

    let error: unknown
    try {
      resolveProviderApiHost(provider, 'searchKeywords')
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'WebSearchConfigError',
      code: 'api_host_missing',
      message: 'API host is required for provider tavily capability searchKeywords'
    })
  })

  it.each(['not-a-url', 'ftp://example.com'])('rejects a non-HTTP(S) API host: %s', (apiHost) => {
    const provider = createProvider({
      capabilities: [{ feature: 'searchKeywords', apiHost }]
    })

    let error: unknown
    try {
      resolveProviderApiHost(provider, 'searchKeywords')
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(WebSearchConfigError)
    expect(error).toMatchObject({
      code: 'api_host_invalid',
      message: 'API host must be a valid HTTP(S) URL for provider tavily capability searchKeywords'
    })
  })

  it('allows a valid localhost HTTP endpoint', () => {
    const provider = createProvider({
      capabilities: [{ feature: 'searchKeywords', apiHost: 'http://localhost:8080/search' }]
    })

    expect(resolveProviderApiHost(provider, 'searchKeywords')).toBe('http://localhost:8080/search')
  })

  it('throws when required API keys are missing after trimming', () => {
    const provider = createProvider({
      id: 'bocha',
      apiKeys: ['  ', '\n']
    })

    let error: unknown
    try {
      new ApiKeyRotationState().resolve(provider)
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: 'WebSearchConfigError',
      code: 'api_key_missing',
      message: 'API key is required for provider bocha'
    })
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
