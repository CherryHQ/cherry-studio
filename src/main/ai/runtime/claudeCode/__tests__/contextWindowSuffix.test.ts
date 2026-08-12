import { describe, expect, it } from 'vitest'

import {
  isAnthropicOfficialHost,
  parseContextWindowSuffix,
  resolveAgentContextWindow,
  with1mSuffix
} from '../contextWindowSuffix'

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

describe('isAnthropicOfficialHost', () => {
  it('is true for api.anthropic.com and for an unset base URL (SDK default)', () => {
    expect(isAnthropicOfficialHost('https://api.anthropic.com')).toBe(true)
    expect(isAnthropicOfficialHost('https://api.anthropic.com/')).toBe(true)
    expect(isAnthropicOfficialHost(undefined)).toBe(true)
    expect(isAnthropicOfficialHost('')).toBe(true)
  })

  it('is false for a custom proxy host, including one derived from the Anthropic preset', () => {
    expect(isAnthropicOfficialHost('https://anthropic.mycorp.com')).toBe(false)
    expect(isAnthropicOfficialHost('https://api.deepseek.com/anthropic')).toBe(false)
  })

  it('is false for an unparseable base URL', () => {
    expect(isAnthropicOfficialHost('not a url')).toBe(false)
  })
})

describe('parseContextWindowSuffix', () => {
  it.each([
    ['deepseek-v4-pro[1m]', 1_000_000],
    ['deepseek-v4-pro[1M]', 1_000_000],
    ['some-model[128k]', 128_000],
    ['some-model[200k]', 200_000],
    ['some-model[1.5m]', 1_500_000]
  ])('parses %s into the declared token count', (id, expected) => {
    expect(parseContextWindowSuffix(id)).toBe(expected)
  })

  it('returns undefined for an id without a trailing bracket annotation', () => {
    expect(parseContextWindowSuffix('deepseek-v4-pro')).toBeUndefined()
    expect(parseContextWindowSuffix('gpt-oss-20b')).toBeUndefined()
  })

  it('ignores a non-trailing bracket so a mid-id marker is not misread', () => {
    // The annotation must be the trailing token; `[1m]-v2` does not declare a 1M window.
    expect(parseContextWindowSuffix('model[1m]-v2')).toBeUndefined()
  })

  it('returns undefined for empty / missing input', () => {
    expect(parseContextWindowSuffix('')).toBeUndefined()
    expect(parseContextWindowSuffix(undefined)).toBeUndefined()
  })
})

describe('resolveAgentContextWindow', () => {
  // Priority: row value > registry preset > id suffix. Each lower tier only runs when every higher
  // tier is undefined, mirroring the `??` chain in agentSessionWarmup.

  it('prefers the row-owned context window over preset and suffix', () => {
    // A preset-backed row already merged the precise value; neither fallback may override it.
    expect(resolveAgentContextWindow(1_048_600, 1_000_000, 'deepseek-v4-pro[1m]')).toBe(1_048_600)
  })

  it('falls back to the registry preset when the row has no value (plain id that missed the match)', () => {
    // A custom row with a plain id that just failed preset matching — the suffix is absent, so the
    // preset window (declared in the catalog) is the right value, not 100K.
    expect(resolveAgentContextWindow(undefined, 1_048_600, 'deepseek-v4-pro')).toBe(1_048_600)
  })

  it('falls back to the id suffix when neither row nor preset has a value (suffixed custom row)', () => {
    // The #18397 case: the [1m] suffix defeated normalizeModelId so the preset never matched
    // (presetContextWindow is undefined); the suffix the user typed is the sole source.
    expect(resolveAgentContextWindow(undefined, undefined, 'deepseek-v4-pro[1m]')).toBe(1_000_000)
  })

  it('prefers the registry preset over the id suffix when both are available but the row is empty', () => {
    // The catalog value is precise (1_048_600); the suffix is an approximation (1_000_000). Preset wins.
    expect(resolveAgentContextWindow(undefined, 1_048_600, 'deepseek-v4-pro[1m]')).toBe(1_048_600)
  })

  it('returns undefined when no source provides a value', () => {
    expect(resolveAgentContextWindow(undefined, undefined, 'deepseek-v4-pro')).toBeUndefined()
    expect(resolveAgentContextWindow(undefined, undefined, undefined)).toBeUndefined()
  })
})
