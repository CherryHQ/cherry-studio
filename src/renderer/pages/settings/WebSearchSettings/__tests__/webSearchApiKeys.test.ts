import { describe, expect, it } from 'vitest'

import {
  normalizeWebSearchApiKeys,
  removeWebSearchApiKey,
  replaceWebSearchApiKey,
  validateWebSearchApiKey
} from '../utils/webSearchApiKeys'

describe('webSearchApiKeys', () => {
  it('trims, removes empty keys and deduplicates API keys', () => {
    expect(normalizeWebSearchApiKeys([' key-a ', '', 'key-b', 'key-a', '   '])).toEqual(['key-a', 'key-b'])
  })

  it('validates empty and duplicate keys', () => {
    expect(validateWebSearchApiKey(' ', [], 'empty', 'duplicate')).toEqual({ isValid: false, error: 'empty' })
    expect(validateWebSearchApiKey('key-a', ['key-a'], 'empty', 'duplicate')).toEqual({
      isValid: false,
      error: 'duplicate'
    })
    expect(validateWebSearchApiKey('key-a', [], 'empty', 'duplicate')).toEqual({ isValid: true })
  })

  it('replaces and removes keys by index', () => {
    expect(replaceWebSearchApiKey(['key-a', 'key-b'], 1, ' key-c ')).toEqual(['key-a', 'key-c'])
    expect(removeWebSearchApiKey(['key-a', 'key-b'], 0)).toEqual(['key-b'])
    expect(replaceWebSearchApiKey(['key-a'], 2, 'key-b')).toBeNull()
    expect(removeWebSearchApiKey(['key-a'], 2)).toBeNull()
  })
})
