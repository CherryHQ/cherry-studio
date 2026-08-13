import { describe, expect, it } from 'vitest'

import { isAssistantActivityTransition, isConversationActivityRole } from '../activityTime'

describe('activityTime', () => {
  it('counts user and assistant rows but ignores structural roles', () => {
    expect(isConversationActivityRole('user')).toBe(true)
    expect(isConversationActivityRole('assistant')).toBe(true)
    expect(isConversationActivityRole('system')).toBe(false)
    expect(isConversationActivityRole('root')).toBe(false)
  })

  it('recognizes pending-to-terminal assistant response segments but ignores rewrites', () => {
    expect(
      isAssistantActivityTransition({
        existingStatus: 'pending',
        role: 'assistant',
        status: 'success'
      })
    ).toBe(true)
    expect(
      isAssistantActivityTransition({
        existingStatus: 'success',
        role: 'assistant',
        status: 'error'
      })
    ).toBe(false)
    expect(
      isAssistantActivityTransition({
        existingStatus: 'pending',
        role: 'assistant',
        status: 'paused'
      })
    ).toBe(true)
    expect(
      isAssistantActivityTransition({
        existingStatus: 'pending',
        role: 'user',
        status: 'success'
      })
    ).toBe(false)
  })
})
