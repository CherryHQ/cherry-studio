import type { Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRotationStateForTests, getRotatedApiKey } from '../apiKeyRotation'

vi.mock('@main/services/LoggerService', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn()
    }))
  }
}))

const buildProvider = (id: string, apiKey: string): Provider =>
  ({
    id,
    apiKey,
    apiHost: 'https://example.com',
    type: 'openai',
    enabled: true,
    name: id
  }) as Provider

describe('getRotatedApiKey', () => {
  beforeEach(() => {
    __resetRotationStateForTests()
  })

  it('returns empty string when apiKey is missing', () => {
    expect(getRotatedApiKey(buildProvider('p', ''))).toBe('')
    expect(getRotatedApiKey(buildProvider('p', '   '))).toBe('')
  })

  it('returns empty string when only whitespace/commas', () => {
    expect(getRotatedApiKey(buildProvider('p', ', , ,'))).toBe('')
  })

  it('returns the single key when only one is configured', () => {
    expect(getRotatedApiKey(buildProvider('p', 'only-key'))).toBe('only-key')
    expect(getRotatedApiKey(buildProvider('p', '  padded-key  '))).toBe('padded-key')
  })

  it('rotates through multiple comma-separated keys', () => {
    const provider = buildProvider('nv', 'key1,key2,key3')

    expect(getRotatedApiKey(provider)).toBe('key1')
    expect(getRotatedApiKey(provider)).toBe('key2')
    expect(getRotatedApiKey(provider)).toBe('key3')
    expect(getRotatedApiKey(provider)).toBe('key1')
  })

  it('trims whitespace and ignores empty segments', () => {
    const provider = buildProvider('nv', ' key1 , ,key2 ')

    expect(getRotatedApiKey(provider)).toBe('key1')
    expect(getRotatedApiKey(provider)).toBe('key2')
    expect(getRotatedApiKey(provider)).toBe('key1')
  })

  it('tracks rotation state per provider independently', () => {
    const a = buildProvider('a', 'a1,a2')
    const b = buildProvider('b', 'b1,b2,b3')

    expect(getRotatedApiKey(a)).toBe('a1')
    expect(getRotatedApiKey(b)).toBe('b1')
    expect(getRotatedApiKey(a)).toBe('a2')
    expect(getRotatedApiKey(b)).toBe('b2')
    expect(getRotatedApiKey(a)).toBe('a1')
    expect(getRotatedApiKey(b)).toBe('b3')
  })

  it('falls back to first key when stored last-used is no longer present', () => {
    const provider = buildProvider('p', 'key1,key2,key3')
    expect(getRotatedApiKey(provider)).toBe('key1')
    expect(getRotatedApiKey(provider)).toBe('key2')

    // Simulate the user removing key2 from config; next call should restart at key1.
    const updated = buildProvider('p', 'key1,key3')
    expect(getRotatedApiKey(updated)).toBe('key1')
  })
})
