import { describe, expect, it } from 'vitest'

import { resolveNewTopicAssistantId } from '../Inputbar.helpers'

describe('Inputbar helpers', () => {
  it('keeps the active topic assistant when no new-topic payload is provided', () => {
    expect(resolveNewTopicAssistantId('assistant-active')).toBe('assistant-active')
  })

  it('uses the target assistant id from a new-topic payload', () => {
    expect(resolveNewTopicAssistantId('assistant-active', { assistantId: 'assistant-target' })).toBe('assistant-target')
  })

  it('resolves null payload assistant id to no assistant for default assistant topics', () => {
    expect(resolveNewTopicAssistantId('assistant-active', { assistantId: null })).toBeUndefined()
  })
})
