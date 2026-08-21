import { ConversationKind, type ConversationRef } from '@shared/ai/conversation'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const useConversationStreamStatus = vi.hoisted(() =>
  vi.fn((conversation: ConversationRef) => ({
    activeExecutions: conversation.kind === ConversationKind.Agent ? [{ outputNodeId: 'agent-assistant-1' }] : [],
    awaitingInteractionExecutions: []
  }))
)

vi.mock('@renderer/hooks/useConversationStreamStatus', () => ({ useConversationStreamStatus }))

import { useMessageActivityState } from '../useMessageActivityState'

describe('useMessageActivityState', () => {
  it('reads activity from the exact Agent conversation identity', () => {
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const { result } = renderHook(() => useMessageActivityState(conversation))

    expect(
      result.current({
        id: 'agent-assistant-1',
        topicId: 'agent-session:session-1',
        role: 'assistant',
        status: 'success',
        createdAt: '2026-01-01T00:00:00.000Z'
      })
    ).toMatchObject({ isProcessing: true, isStreamTarget: true })
  })
})
