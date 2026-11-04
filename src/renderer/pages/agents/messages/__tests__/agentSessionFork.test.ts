import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '@renderer/components/chat/messages/types'

import { agentSessionForkAvailability, agentSessionForkReasonLabel } from '../agentSessionFork'

const t = ((key: string) => key) as TFunction
const message = { id: 'id', role: 'assistant', status: 'success' } as MessageListItem

describe('fork availability', () => {
  it('distinguishes hidden, pending, confirmed and unknown states', () => {
    expect(agentSessionForkAvailability(t, { ...message, role: 'user' })).toBe(false)
    expect(agentSessionForkAvailability(t, { ...message, status: 'pending' })).toEqual({
      visible: true,
      enabled: false,
      reason: 'agent_session_fork.not_turn_boundary'
    })
    expect(agentSessionForkAvailability(t, message)).toEqual({ visible: true, enabled: false })
    expect(agentSessionForkAvailability(t, message, { enabled: true })).toEqual({ visible: true, enabled: true })
    expect(agentSessionForkAvailability(t, message, { enabled: false, reason: 'legacy_history' })).toEqual({
      visible: true,
      enabled: false,
      reason: 'agent_session_fork.legacy_history'
    })
    expect(agentSessionForkAvailability(t, message, { enabled: null, reason: 'operation_failed' })).toEqual({
      visible: true,
      enabled: true,
      reason: 'agent_session_fork.operation_failed'
    })
  })
  it.each([
    ['source_changed', 'agent_session_fork.history_changed'],
    ['source_missing', 'agent_session_fork.operation_failed'],
    ['operation_failed', 'agent_session_fork.operation_failed'],
    ['cancelled', 'message.tools.cancelled'],
    ['history_changed', 'agent_session_fork.history_changed']
  ] as const)('maps %s', (reason, label) => {
    expect(agentSessionForkReasonLabel(t, reason)).toBe(label)
  })
})
