import type { TopicStatusSnapshotEntry, TopicStreamStatus } from '@shared/ai/transport'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cacheValues = vi.hoisted(() => new Map<string, unknown>())
const selectorKeys = vi.hoisted(() => [] as string[][])
const historyHooks = vi.hoisted(() => ({
  useTopics: vi.fn(() => ({ topics: [] })),
  useSessions: vi.fn(() => ({ sessions: [] }))
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCacheSelector: (keys: readonly string[], selector: (values: readonly unknown[]) => unknown) => {
    selectorKeys.push([...keys])
    return selector(keys.map((key) => cacheValues.get(key)))
  }
}))

vi.mock('@renderer/hooks/useTopic', () => ({ useTopics: historyHooks.useTopics }))
vi.mock('@renderer/hooks/agent/useSession', () => ({ useSessions: historyHooks.useSessions }))

import { aggregateConversationTaskStatus, useWorkspaceTaskStatuses } from '../useWorkspaceTaskStatuses'

function entry(status: TopicStreamStatus, lastCompletedAt?: number): TopicStatusSnapshotEntry {
  return {
    status,
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    lastCompletedAt
  }
}

describe('aggregateConversationTaskStatus', () => {
  it('uses action-required, error, running, completed, idle priority', () => {
    const approval = entry('awaiting-approval')
    const error = entry('error')
    const running = entry('streaming')
    const completed = entry('done', 42)

    expect(aggregateConversationTaskStatus([completed, running, error, approval])).toBe('action-required')
    expect(aggregateConversationTaskStatus([completed, running, error])).toBe('error')
    expect(aggregateConversationTaskStatus([completed, running])).toBe('running')
    expect(aggregateConversationTaskStatus([completed])).toBe('completed')
    expect(aggregateConversationTaskStatus([entry('aborted')])).toBe('idle')
    expect(aggregateConversationTaskStatus([])).toBe('idle')
  })

  it('treats a live stream with an approval anchor as action-required', () => {
    const streaming = entry('streaming')
    streaming.awaitingApprovalAnchors = [{ executionId: 'provider::model', attemptId: 1 }]

    expect(aggregateConversationTaskStatus([streaming])).toBe('action-required')
  })
})

describe('useWorkspaceTaskStatuses', () => {
  beforeEach(() => {
    cacheValues.clear()
    selectorKeys.length = 0
    historyHooks.useTopics.mockClear()
    historyHooks.useSessions.mockClear()
  })

  it('derives Chat and Agent status from one runtime index without loading conversation history', () => {
    cacheValues.set('topic.stream.status_index', {
      'chat-topic': entry('done', 42),
      'agent-session:session-1': entry('streaming')
    })

    const { result } = renderHook(() => useWorkspaceTaskStatuses())

    expect(result.current.get('assistants')).toBe('completed')
    expect(result.current.get('agents')).toBe('running')
    expect(historyHooks.useTopics).not.toHaveBeenCalled()
    expect(historyHooks.useSessions).not.toHaveBeenCalled()
  })

  it('does not observe the runtime index outside Sidebar-only layout', () => {
    cacheValues.set('topic.stream.status_index', {
      'chat-topic': entry('streaming')
    })

    const { result } = renderHook(() => useWorkspaceTaskStatuses(false))

    expect(selectorKeys).toEqual([[]])
    expect(result.current.get('assistants')).toBe('idle')
    expect(result.current.get('agents')).toBe('idle')
  })
})
