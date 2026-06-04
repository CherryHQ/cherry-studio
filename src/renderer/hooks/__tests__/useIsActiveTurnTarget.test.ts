import type { ActiveExecution } from '@shared/ai/transport'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '../../types/newMessage'
import { useIsActiveTurnTarget } from '../useIsActiveTurnTarget'

const isMessageProcessingMock = vi.fn<(m: Message) => boolean>()
vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageProcessing: (m: Message) => isMessageProcessingMock(m)
}))

const activeExecutionsMock = vi.fn<() => ActiveExecution[]>(() => [])
const awaitingApprovalAnchorsMock = vi.fn<() => ActiveExecution[]>(() => [])
vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: undefined,
    activeExecutions: activeExecutionsMock(),
    awaitingApprovalAnchors: awaitingApprovalAnchorsMock(),
    isPending: false,
    isFulfilled: false,
    markSeen: () => {}
  })
}))

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    topicId: 't',
    role: 'assistant',
    status: 'success' as never,
    ...overrides
  } as Message
}

describe('useIsActiveTurnTarget', () => {
  beforeEach(() => {
    isMessageProcessingMock.mockReset().mockReturnValue(false)
    activeExecutionsMock.mockReset().mockReturnValue([])
    awaitingApprovalAnchorsMock.mockReset().mockReturnValue([])
  })

  it('true when `isMessageProcessing` is true (per-message DB status PENDING/PROCESSING/SEARCHING)', () => {
    isMessageProcessingMock.mockReturnValue(true)
    expect(renderHook(() => useIsActiveTurnTarget(msg())).result.current).toBe(true)
  })

  it('true when this message id is in `activeExecutions` (live streaming target)', () => {
    activeExecutionsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'm1' }])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1' }))).result.current).toBe(true)
  })

  it('true when this message id is in `awaitingApprovalAnchors` (Main-broadcast approval anchor)', () => {
    awaitingApprovalAnchorsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'm1' }])
    // Crucially the message's DB status is 'success' here — the MCP
    // `needsApproval` flow ends cleanly via `done`. The old proxy
    // (`status === 'paused' && isAwaitingApproval`) failed exactly this case
    // and let the menubar leak through. The Main-broadcast anchor id makes
    // it work by construction.
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1', status: 'success' as never }))).result.current).toBe(
      true
    )
  })

  it('false for a user message even when the topic has awaiting anchors', () => {
    awaitingApprovalAnchorsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'OTHER' }])
    expect(
      renderHook(() => useIsActiveTurnTarget(msg({ role: 'user', status: 'success' as never }))).result.current
    ).toBe(false)
  })

  it('false for an old completed assistant (no signal matches)', () => {
    activeExecutionsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'OTHER' }])
    awaitingApprovalAnchorsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'OTHER' }])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1' }))).result.current).toBe(false)
  })
})
