import type { TopicStreamStatus } from '@shared/ai/transport'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEntry = vi.fn<() => { status: TopicStreamStatus | undefined } | undefined>()

// Mock at the cache layer (intra-module calls can't be intercepted at the hook).
vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: () => [mockEntry()]
}))

import { useTopicOverlayHandoffOnTerminal } from '../useTopicStreamStatus'

const setStatus = (status: TopicStreamStatus | undefined) => mockEntry.mockReturnValue({ status })

describe('useTopicOverlayHandoffOnTerminal', () => {
  beforeEach(() => mockEntry.mockReset())

  it.each<TopicStreamStatus>(['done', 'error', 'aborted'])('fires once on streaming → %s', async (terminal) => {
    const handoff = vi.fn(async () => {})
    setStatus('streaming')
    const { rerender } = renderHook(() => useTopicOverlayHandoffOnTerminal('t', handoff))
    expect(handoff).not.toHaveBeenCalled()

    setStatus(terminal)
    await act(async () => {
      rerender()
    })
    expect(handoff).toHaveBeenCalledTimes(1)

    // No double-fire while it stays terminal.
    await act(async () => {
      rerender()
    })
    expect(handoff).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire on streaming → awaiting-approval (the MCP card must stay)', async () => {
    const handoff = vi.fn(async () => {})
    setStatus('streaming')
    const { rerender } = renderHook(() => useTopicOverlayHandoffOnTerminal('t', handoff))

    setStatus('awaiting-approval')
    await act(async () => {
      rerender()
    })
    expect(handoff).not.toHaveBeenCalled()
  })

  it('fires on the later live → done edge after a continue stream resumes an approval', async () => {
    const handoff = vi.fn(async () => {})
    setStatus('streaming')
    const { rerender } = renderHook(() => useTopicOverlayHandoffOnTerminal('t', handoff))

    setStatus('awaiting-approval')
    await act(async () => {
      rerender()
    })
    expect(handoff).not.toHaveBeenCalled()

    // Continue stream: awaiting-approval → streaming → done.
    setStatus('streaming')
    await act(async () => {
      rerender()
    })
    setStatus('done')
    await act(async () => {
      rerender()
    })
    expect(handoff).toHaveBeenCalledTimes(1)
  })

  it('runs refresh before dispose (no stale-base flicker)', async () => {
    const order: string[] = []
    const refresh = vi.fn(async () => {
      order.push('refresh')
    })
    const dispose = vi.fn(() => {
      order.push('dispose')
    })
    const handoff = async () => {
      try {
        await refresh()
      } finally {
        dispose()
      }
    }

    setStatus('streaming')
    const { rerender } = renderHook(() => useTopicOverlayHandoffOnTerminal('t', handoff))
    setStatus('done')
    await act(async () => {
      rerender()
      await Promise.resolve()
    })
    expect(order).toEqual(['refresh', 'dispose'])
  })
})
