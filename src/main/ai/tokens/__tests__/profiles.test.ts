import { describe, expect, it } from 'vitest'

import { resolveTokenDialect } from '../dialect'
import { getTextTokenizer, imageTokensFor } from '../profiles'

describe('resolveTokenDialect', () => {
  it.each([
    ['anthropic', 'anthropic'],
    ['google-vertex-anthropic', 'anthropic'],
    ['google', 'google'],
    ['google-vertex', 'google'],
    ['ollama', 'ollama'],
    ['openai', 'openai'],
    ['openai-compatible', 'openai'],
    ['deepseek', 'openai'],
    ['some-unknown-relay', 'openai']
  ] as const)('maps adapterFamily %s → %s', (family, dialect) => {
    expect(resolveTokenDialect(family)).toBe(dialect)
  })

  it('falls back to openai for undefined', () => {
    expect(resolveTokenDialect(undefined)).toBe('openai')
  })
})

describe('profile accessors', () => {
  it('uses the real BPE tokenizer for openai (lazy-loaded) and tokenx elsewhere', async () => {
    expect((await getTextTokenizer('openai')).id).toBe('gpt-tokenizer/o200k')
    for (const dialect of ['anthropic', 'google', 'ollama'] as const) {
      expect((await getTextTokenizer(dialect)).id).toBe('tokenx')
    }
  })

  it('returns the documented per-dialect constant when dimensions are unknown', () => {
    expect(imageTokensFor('anthropic')).toBe(1590)
    expect(imageTokensFor('openai')).toBe(765)
    expect(imageTokensFor('google')).toBe(258)
    expect(imageTokensFor('ollama')).toBe(1000)
  })

  it('applies the pixel formula when dimensions are provided', () => {
    // Under the 1.15 MP budget → straight ceil(w·h/750); ollama ignores dims (flat constant).
    expect(imageTokensFor('anthropic', { width: 750, height: 750 })).toBe(Math.ceil((750 * 750) / 750))
    expect(imageTokensFor('ollama', { width: 4000, height: 4000 })).toBe(1000)
  })
})
