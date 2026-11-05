import { describe, expect, it } from 'vitest'

import { usesBasicAnthropicWebTools } from '../index'

describe('Anthropic web tool versions', () => {
  it.each([
    'claude-haiku-4-5',
    'claude-opus-4',
    'claude-opus-4-1',
    'claude-opus-4-5',
    'claude-sonnet-4',
    'claude-sonnet-4-5',
    'claude-opus-4-5-20260219',
    'anthropic.claude-opus-4-5-20251101-v1:0',
    'anthropic/claude-opus-4.5'
  ])('requires basic schema for %s', (id) => {
    expect(usesBasicAnthropicWebTools(id)).toBe(true)
  })
  it.each([
    'claude-opus-4-6',
    'global.anthropic.claude-opus-4-6-v1:0',
    'qwen3.8-max',
    'production-chat',
    'claude-opus-4-5-private-preview'
  ])('does not override %s', (id) => {
    expect(usesBasicAnthropicWebTools(id)).toBe(false)
  })
})
