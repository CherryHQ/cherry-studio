import { useQuery } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChannels } from '../useChannels'
import { useSession } from '../useSessionDataApi'
import { useTaskLogs, useTasks } from '../useTasks'

describe('identity-scoped agent queries', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('disables keepPreviousData for session detail queries', () => {
    renderHook(() => useSession('session-1'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/sessions/:sessionId',
      expect.objectContaining({
        enabled: true,
        swrOptions: { keepPreviousData: false }
      })
    )
  })

  it('disables keepPreviousData for task list and task log queries', () => {
    renderHook(() => useTasks('agent-1'))
    renderHook(() => useTaskLogs('agent-1', 'task-1'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/agents/:agentId/tasks',
      expect.objectContaining({
        enabled: true,
        swrOptions: { keepPreviousData: false }
      })
    )
    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/agents/:agentId/tasks/:taskId/logs',
      expect.objectContaining({
        enabled: true,
        swrOptions: { keepPreviousData: false }
      })
    )
  })

  it('disables keepPreviousData for channel queries', () => {
    renderHook(() => useChannels('telegram'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/channels',
      expect.objectContaining({
        query: { type: 'telegram' },
        swrOptions: { keepPreviousData: false }
      })
    )
  })
})
