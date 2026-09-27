import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { resolveRegenerateModelOverride } from '../resolveRegenerateModelOverride'

function assistantMessage(modelId: string): CherryUIMessage {
  return {
    id: 'a1',
    role: 'assistant',
    parts: [],
    metadata: { modelId, status: 'error' }
  }
}

describe('resolveRegenerateModelOverride', () => {
  it('returns undefined when the composer model matches the failed assistant model', () => {
    expect(resolveRegenerateModelOverride(assistantMessage('provider-a::model-x'), 'provider-a::model-x')).toBeUndefined()
  })

  it('returns the composer model when it differs from the failed assistant model', () => {
    expect(resolveRegenerateModelOverride(assistantMessage('provider-a::model-x'), 'provider-b::model-x')).toBe(
      'provider-b::model-x'
    )
  })

  it('returns the composer model when the assistant message has no persisted model id', () => {
    const message = assistantMessage('provider-a::model-x')
    delete message.metadata?.modelId
    expect(resolveRegenerateModelOverride(message, 'provider-b::model-x')).toBe('provider-b::model-x')
  })
})
