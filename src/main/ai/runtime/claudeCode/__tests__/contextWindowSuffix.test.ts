import { describe, expect, it } from 'vitest'

import { with1mSuffix } from '../contextWindowSuffix'

describe('with1mSuffix', () => {
  it('appends [1m] when a non-Anthropic model declares >= 1M context', () => {
    // deepseek-chat / deepseek-reasoner declare exactly 1,000,000 — the `>=` boundary case.
    expect(with1mSuffix('deepseek-chat', 1_000_000, false)).toBe('deepseek-chat[1m]')
    expect(with1mSuffix('deepseek-v4-pro', 1_048_576, false)).toBe('deepseek-v4-pro[1m]')
  })

  it('leaves the id untouched below 1M or without a declared context window', () => {
    expect(with1mSuffix('deepseek-v3', 163_840, false)).toBe('deepseek-v3')
    expect(with1mSuffix('deepseek-v3', undefined, false)).toBe('deepseek-v3')
  })

  it('never appends for the real Anthropic provider, even at 1M (its 1M is a gated beta)', () => {
    expect(with1mSuffix('claude-sonnet-4-5', 1_000_000, true)).toBe('claude-sonnet-4-5')
  })

  it('does not double-suffix an id that already carries [1m]', () => {
    expect(with1mSuffix('deepseek-chat[1m]', 1_000_000, false)).toBe('deepseek-chat[1m]')
  })

  it('returns empty string for a missing model id', () => {
    expect(with1mSuffix(undefined, 1_000_000, false)).toBe('')
  })
})
