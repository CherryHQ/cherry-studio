import type { TopicStreamStatus } from '@shared/ai/transport'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mockStatus = vi.fn<() => TopicStreamStatus | undefined>()

// Mock at the cache layer rather than at useTopicStreamStatus — intra-module
// vi.mock can't intercept calls between functions in the same source file.
vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: () => [{ status: mockStatus(), activeExecutions: [], awaitingApprovalAnchors: [] }]
}))

import { useTopicAwaitingApproval } from '../useTopicStreamStatus'

describe('useTopicAwaitingApproval', () => {
  it('is true iff the cross-window shared-cache status is awaiting-approval', () => {
    mockStatus.mockReturnValue('awaiting-approval')
    expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(true)
  })

  it.each<TopicStreamStatus | undefined>(['pending', 'streaming', 'aborted', 'done', 'error', undefined])(
    'is false for status %s (no per-window partsMap scan / SWR dependency)',
    (status) => {
      mockStatus.mockReturnValue(status)
      expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(false)
    }
  )
})
