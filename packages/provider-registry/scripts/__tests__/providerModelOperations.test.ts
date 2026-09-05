import { describe, expect, it } from 'vitest'

import { normalizeProviderModelOperations } from '../providerModelOperations'

describe('normalizeProviderModelOperations', () => {
  it('restores the inherited operation when capabilities.force contains only functional capabilities', () => {
    const normalized = normalizeProviderModelOperations(
      {
        providerId: 'provider',
        modelId: 'reasoning-model',
        capabilities: { force: ['reasoning'] }
      },
      ['text-generation', 'reasoning']
    )

    expect(normalized.capabilities).toEqual({ force: ['reasoning', 'text-generation'] })
  })

  it('classifies a standalone image override as image generation without adding text generation', () => {
    const normalized = normalizeProviderModelOperations(
      {
        providerId: 'provider',
        modelId: 'image-model',
        imageGeneration: { modes: {} }
      },
      undefined
    )

    expect(normalized).toMatchObject({
      name: 'image-model',
      capabilities: { add: ['image-generation'] }
    })
  })

  it('does not repair an invalid incremental override of an existing model', () => {
    const normalized = normalizeProviderModelOperations(
      {
        providerId: 'provider',
        modelId: 'chat-model',
        capabilities: { remove: ['text-generation'] }
      },
      ['text-generation']
    )

    expect(normalized.capabilities).toEqual({ remove: ['text-generation'] })
  })
})
