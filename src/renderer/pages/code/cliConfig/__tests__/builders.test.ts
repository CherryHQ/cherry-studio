import { describe, expect, it } from 'vitest'

import { buildQwenConfig } from '../builders'

describe('buildQwenConfig', () => {
  const resolved = { apiKey: 'sk-test', baseUrl: 'https://example.com', model: 'qwen-max', modelLabel: 'Qwen Max' }

  // Regression: a hand-edited ~/.qwen/settings.json can have `security` / `modelProviders` as any
  // JSON type. Spreading a non-object directly (e.g. `{ ...existing.security }` on a string) fans it
  // out by index instead of producing an empty object, silently corrupting the written config.
  it('tolerates a non-object security/auth/modelProviders in the existing config instead of index-spreading it', () => {
    const existing = {
      security: 'not-an-object',
      modelProviders: ['not-an-object-either']
    }

    const result = buildQwenConfig(existing, resolved, {})

    expect(result.security).toEqual({ auth: { selectedType: 'openai' } })
    expect(Array.isArray(result.modelProviders)).toBe(false)
    expect(result.modelProviders.openai).toEqual([
      { id: 'qwen-max', name: 'Qwen Max', baseUrl: 'https://example.com', envKey: 'CHERRY_QWEN_API_KEY' }
    ])
  })

  it('preserves unrelated existing security/auth fields', () => {
    const existing = {
      security: { auth: { someOtherField: 'keep-me' }, unrelated: true }
    }

    const result = buildQwenConfig(existing, resolved, {})

    expect(result.security).toEqual({
      unrelated: true,
      auth: { someOtherField: 'keep-me', selectedType: 'openai' }
    })
  })
})
