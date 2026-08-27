import { toConversationExecutionId, toConversationTurnId } from '@shared/ai/conversation'
import type { ConversationExecutionProjection } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../components/chat/messages/types'
import { useIsActiveTurnTarget } from '../useIsActiveTurnTarget'

const activeExecutionsMock = vi.fn<() => ConversationExecutionProjection[]>(() => [])
const awaitingInteractionExecutionsMock = vi.fn<() => ConversationExecutionProjection[]>(() => [])
vi.mock('../useConversationStreamStatus', () => ({
  useConversationStreamStatus: () => ({
    status: undefined,
    activeExecutions: activeExecutionsMock(),
    awaitingInteractionExecutions: awaitingInteractionExecutionsMock(),
    isPending: false,
    isFulfilled: false,
    markSeen: () => {}
  })
}))

function msg(overrides: Partial<MessageListItem> = {}): MessageListItem {
  return {
    id: 'm1',
    topicId: 't',
    role: 'assistant',
    status: 'success',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides
  } as MessageListItem
}

function execution(outputNodeId: string): ConversationExecutionProjection {
  return {
    turnId: toConversationTurnId('turn-1'),
    executionId: toConversationExecutionId(`execution-${outputNodeId}`),
    modelId: 'p::m' as UniqueModelId,
    outputNodeId
  }
}

describe('useIsActiveTurnTarget', () => {
  beforeEach(() => {
    activeExecutionsMock.mockReset().mockReturnValue([])
    awaitingInteractionExecutionsMock.mockReset().mockReturnValue([])
  })

  it('true when message DB status is pending', () => {
    expect(renderHook(() => useIsActiveTurnTarget(msg({ status: 'pending' }))).result.current).toBe(true)
  })

  it('true when this message id is in `activeExecutions` (live streaming target)', () => {
    activeExecutionsMock.mockReturnValue([execution('m1')])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1' }))).result.current).toBe(true)
  })

  it('true when this message id is an awaiting-interaction execution output', () => {
    awaitingInteractionExecutionsMock.mockReturnValue([execution('m1')])
    // Crucially the message's DB status is 'success' here — the MCP
    // `needsApproval` flow ends cleanly via `done`. The old proxy
    // (`status === 'paused' && isAwaitingApproval`) failed exactly this case
    // and let the menubar leak through. The Main-broadcast output id makes
    // it work by construction.
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1', status: 'success' }))).result.current).toBe(true)
  })

  it('false for a user message even when the topic has awaiting anchors', () => {
    awaitingInteractionExecutionsMock.mockReturnValue([execution('OTHER')])
    expect(
      renderHook(() => useIsActiveTurnTarget(msg({ role: 'user', status: 'success' as never }))).result.current
    ).toBe(false)
  })

  it('false for an old completed assistant (no signal matches)', () => {
    activeExecutionsMock.mockReturnValue([execution('OTHER')])
    awaitingInteractionExecutionsMock.mockReturnValue([execution('OTHER')])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1' }))).result.current).toBe(false)
  })
})
