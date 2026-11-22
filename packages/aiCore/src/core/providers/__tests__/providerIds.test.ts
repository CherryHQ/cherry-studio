import { describe, expect, it } from 'vitest'

import { registeredProviderIds } from '../core/initialization'

describe('registered provider ID resolution', () => {
  it('keeps canonical IDs and resolves aliases to the canonical provider', () => {
    expect(registeredProviderIds.openai).toBe('openai')
    expect(registeredProviderIds.claude).toBe('anthropic')
    expect(registeredProviderIds['azure-openai']).toBe('azure')
    expect(registeredProviderIds.gemini).toBe('google')
  })

  it.each(['openai-chat', 'azure-responses', 'azure-anthropic', 'xai-responses', 'cherryin-chat'] as const)(
    'preserves the %s variant instead of falling back to its base provider',
    (id) => {
      expect(registeredProviderIds[id]).toBe(id)
    }
  )
})
