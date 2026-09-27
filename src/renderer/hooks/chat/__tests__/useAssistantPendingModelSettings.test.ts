import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import { useAssistantPendingReasoningEffort } from '../useAssistantPendingModelSettings'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

describe('useAssistantPendingReasoningEffort', () => {
  it('shares pending reasoning effort across hook instances for the same assistant', () => {
    const assistantId = 'assistant-1'
    const pendingKey = `chat.assistant.reasoning_effort_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const canonical = renderHook(() => useAssistantPendingReasoningEffort(assistantId, 'default'))
    const consumer = renderHook(() => useAssistantPendingReasoningEffort(assistantId, 'default'))

    expect(canonical.result.current.effective).toBe('default')
    expect(consumer.result.current.effective).toBe('default')

    act(() => {
      canonical.result.current.startPending('high')
    })

    expect(canonical.result.current.effective).toBe('high')
    expect(consumer.result.current.effective).toBe('high')

    act(() => {
      canonical.result.current.finishPending(1)
    })

    expect(canonical.result.current.effective).toBe('default')
    expect(consumer.result.current.effective).toBe('default')
  })
})
