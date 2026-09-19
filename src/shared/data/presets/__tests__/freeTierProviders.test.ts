import { describe, expect, it } from 'vitest'

import { FREE_ACCESS_PROVIDERS, freeAccessKindOf, isFreeAccessProvider } from '../freeTierProviders'

describe('freeTierProviders', () => {
  it('names providers that exist in the registry', async () => {
    // The catalog is keyed by provider id. A typo would silently mark nothing, and the filter
    // would quietly return a shorter list than it should.
    const { PROVIDERS } = await import('@cherrystudio/provider-registry')
    const registered = new Set(PROVIDERS.map((preset) => preset.id))

    const unknown = Object.keys(FREE_ACCESS_PROVIDERS).filter((id) => !registered.has(id))
    expect(unknown).toEqual([])
  })

  it('separates a local provider from one that needs a key', () => {
    expect(freeAccessKindOf('ollama')).toBe('local')
    expect(freeAccessKindOf('groq')).toBe('free-tier')
  })

  it('leaves a paid provider unmarked', () => {
    expect(freeAccessKindOf('anthropic')).toBeUndefined()
    expect(isFreeAccessProvider('anthropic')).toBe(false)
  })
})
