import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import { hasUsableCredential } from '../provider'

type Fixture = Pick<Provider, 'authOptional' | 'authMethods' | 'apiKeys'>

const fixture = (overrides: Partial<Fixture> = {}): Fixture => ({
  authOptional: undefined,
  authMethods: undefined,
  apiKeys: [],
  ...overrides
})

describe('hasUsableCredential', () => {
  it('is true for an authOptional provider even with no keys (local servers like LM Studio)', () => {
    expect(hasUsableCredential(fixture({ authOptional: true }))).toBe(true)
  })

  it('is true for a login-based provider even with no keys (OAuth/CLI login)', () => {
    expect(hasUsableCredential(fixture({ authMethods: ['oauth'] }))).toBe(true)
  })

  it('is false for an ordinary api-key provider with no keys at all', () => {
    expect(hasUsableCredential(fixture({ apiKeys: [] }))).toBe(false)
  })

  // The regression this guards: `enabled: true` on the provider only means the user wants it
  // considered, not that it can serve a request — every key can still be individually disabled.
  it('is false when every declared key is disabled', () => {
    expect(
      hasUsableCredential(fixture({ apiKeys: [{ id: 'a', isEnabled: false } as Provider['apiKeys'][number]] }))
    ).toBe(false)
  })

  it('is true once at least one key is enabled', () => {
    expect(
      hasUsableCredential(
        fixture({
          apiKeys: [
            { id: 'a', isEnabled: false } as Provider['apiKeys'][number],
            { id: 'b', isEnabled: true } as Provider['apiKeys'][number]
          ]
        })
      )
    ).toBe(true)
  })
})
