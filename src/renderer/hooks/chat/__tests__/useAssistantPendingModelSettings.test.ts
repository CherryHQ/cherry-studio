import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import {
  useAssistantPendingReasoningEffort,
  useAssistantPendingSettingsPatch
} from '../useAssistantPendingModelSettings'

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

  it('does not clear a newer pending value when an older mutation finishes', () => {
    const assistantId = 'assistant-2'
    const pendingKey = `chat.assistant.reasoning_effort_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const first = renderHook(() => useAssistantPendingReasoningEffort(assistantId, 'default'))
    const second = renderHook(() => useAssistantPendingReasoningEffort(assistantId, 'default'))

    let firstVersion = 0
    let secondVersion = 0
    act(() => {
      firstVersion = first.result.current.startPending('medium')
      secondVersion = second.result.current.startPending('high')
    })

    expect(first.result.current.effective).toBe('high')
    expect(secondVersion).toBeGreaterThan(firstVersion)

    act(() => {
      first.result.current.finishPending(firstVersion)
    })

    expect(first.result.current.effective).toBe('high')
    expect(second.result.current.effective).toBe('high')

    act(() => {
      second.result.current.finishPending(secondVersion)
    })

    expect(first.result.current.effective).toBe('default')
    expect(second.result.current.effective).toBe('default')
  })
})

describe('useAssistantPendingSettingsPatch', () => {
  it('keeps newer pending sampling values when an older mutation finishes first', () => {
    const assistantId = 'assistant-3'
    const pendingKey = `chat.assistant.settings_patch_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const canonical = { ...DEFAULT_ASSISTANT_SETTINGS, temperature: 1, topP: 1 }
    const first = renderHook(() => useAssistantPendingSettingsPatch(assistantId, canonical))
    const second = renderHook(() => useAssistantPendingSettingsPatch(assistantId, canonical))

    let firstVersion = 0
    let secondVersion = 0
    act(() => {
      firstVersion = first.result.current.startPending({ temperature: 0.2 })
      secondVersion = second.result.current.startPending({ topP: 0.5 })
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.2)
    expect(first.result.current.effectiveSettings?.topP).toBe(0.5)

    act(() => {
      first.result.current.finishPending(firstVersion)
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(1)
    expect(first.result.current.effectiveSettings?.topP).toBe(0.5)

    act(() => {
      second.result.current.finishPending(secondVersion)
    })

    expect(first.result.current.effectiveSettings).toEqual(canonical)
  })

  it('does not keep superseded field values when a newer mutation finishes first', () => {
    const assistantId = 'assistant-4'
    const pendingKey = `chat.assistant.settings_patch_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const canonical = { ...DEFAULT_ASSISTANT_SETTINGS, temperature: 1 }
    const first = renderHook(() => useAssistantPendingSettingsPatch(assistantId, canonical))
    const second = renderHook(() => useAssistantPendingSettingsPatch(assistantId, canonical))

    let firstVersion = 0
    let secondVersion = 0
    act(() => {
      firstVersion = first.result.current.startPending({ temperature: 0.2 })
      secondVersion = second.result.current.startPending({ temperature: 0.8 })
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.8)

    act(() => {
      second.result.current.finishPending(secondVersion)
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(1)
    expect(first.result.current.pendingPatch).toBeUndefined()

    act(() => {
      first.result.current.finishPending(firstVersion)
    })

    expect(first.result.current.effectiveSettings).toEqual(canonical)
  })
})
