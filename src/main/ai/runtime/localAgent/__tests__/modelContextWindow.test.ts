import { describe, expect, it } from 'vitest'

import { resolveLocalModelContextWindow } from '../modelContextWindow'

describe('modelContextWindow', () => {
  it('prefers valid runtime-declared windows and ignores non-positive or non-finite values', () => {
    expect(resolveLocalModelContextWindow('codex/gpt-6.2-sol', 258_400)).toBe(258_400)
    expect(resolveLocalModelContextWindow('codex/gpt-6.2-sol', 0)).toBeUndefined()
    expect(resolveLocalModelContextWindow('codex/gpt-6.2-sol', -100)).toBeUndefined()
    expect(resolveLocalModelContextWindow('codex/gpt-6.2-sol', Number.NaN)).toBeUndefined()
    expect(resolveLocalModelContextWindow('cherryin:anthropic/claude-haiku-4.5', null)).toBe(200_000)
  })

  it('strips gateway and provider prefixes before matching known model families', () => {
    expect(resolveLocalModelContextWindow('cherryin:anthropic/claude-haiku-4.5')).toBe(200_000)
    expect(resolveLocalModelContextWindow('anthropic/claude-opus-5-5')).toBe(200_000)
    expect(resolveLocalModelContextWindow('claude-sonnet-4-6[1m]')).toBe(1_000_000)
    expect(resolveLocalModelContextWindow('openai/gpt-5-codex')).toBe(400_000)
    expect(resolveLocalModelContextWindow('google:gemini-4-neon')).toBe(1_048_576)
    expect(resolveLocalModelContextWindow('gpt-4o-mini')).toBe(128_000)
  })

  it('returns undefined rather than inventing windows for unknown models', () => {
    expect(resolveLocalModelContextWindow('codex/gpt-6.2-sol')).toBeUndefined()
    expect(resolveLocalModelContextWindow('custom-model')).toBeUndefined()
    expect(resolveLocalModelContextWindow(undefined)).toBeUndefined()
    expect(resolveLocalModelContextWindow('')).toBeUndefined()
  })
})
