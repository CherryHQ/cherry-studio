import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

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

    const hook = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) =>
        useAssistantPendingReasoningEffort(assistantId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )
    const consumer = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) =>
        useAssistantPendingReasoningEffort(assistantId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )

    expect(hook.result.current.effective).toBe('default')
    expect(consumer.result.current.effective).toBe('default')

    act(() => {
      hook.result.current.startPending('high')
    })

    expect(hook.result.current.effective).toBe('high')
    expect(consumer.result.current.effective).toBe('high')

    act(() => {
      hook.result.current.finishPending(1)
    })

    expect(hook.result.current.effective).toBe('high')

    act(() => {
      hook.rerender({ canonical: 'high' })
      consumer.rerender({ canonical: 'high' })
    })

    expect(hook.result.current.effective).toBe('high')
    expect(consumer.result.current.effective).toBe('high')
  })

  it('does not clear a newer pending value when an older mutation finishes', () => {
    const assistantId = 'assistant-2'
    const pendingKey = `chat.assistant.reasoning_effort_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const first = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) =>
        useAssistantPendingReasoningEffort(assistantId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )
    const second = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) =>
        useAssistantPendingReasoningEffort(assistantId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )

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

    expect(first.result.current.effective).toBe('high')

    act(() => {
      first.rerender({ canonical: 'high' })
      second.rerender({ canonical: 'high' })
    })

    expect(first.result.current.effective).toBe('high')
    expect(second.result.current.effective).toBe('high')
  })

  it('reverts optimistic values when persistence fails', () => {
    const assistantId = 'assistant-5'
    const pendingKey = `chat.assistant.reasoning_effort_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const { result } = renderHook(() => useAssistantPendingReasoningEffort(assistantId, 'default'))

    let version = 0
    act(() => {
      version = result.current.startPending('high')
    })
    expect(result.current.effective).toBe('high')

    act(() => {
      result.current.finishPending(version, true)
    })

    expect(result.current.effective).toBe('default')
  })
})

describe('useAssistantPendingSettingsPatch', () => {
  it('keeps newer pending sampling values when an older mutation finishes first', () => {
    const assistantId = 'assistant-3'
    const pendingKey = `chat.assistant.settings_patch_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const canonical = { ...DEFAULT_ASSISTANT_SETTINGS, temperature: 1, topP: 1 }
    const first = renderHook(({ settings }) => useAssistantPendingSettingsPatch(assistantId, settings), {
      initialProps: { settings: canonical }
    })
    const second = renderHook(({ settings }) => useAssistantPendingSettingsPatch(assistantId, settings), {
      initialProps: { settings: canonical }
    })

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

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.2)
    expect(first.result.current.effectiveSettings?.topP).toBe(0.5)

    act(() => {
      first.rerender({ settings: { ...canonical, temperature: 0.2 } })
      second.rerender({ settings: { ...canonical, temperature: 0.2 } })
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.2)
    expect(first.result.current.effectiveSettings?.topP).toBe(0.5)

    act(() => {
      second.result.current.finishPending(secondVersion)
    })

    act(() => {
      const synced = { ...canonical, temperature: 0.2, topP: 0.5 }
      first.rerender({ settings: synced })
      second.rerender({ settings: synced })
    })

    expect(first.result.current.effectiveSettings).toEqual({ ...canonical, temperature: 0.2, topP: 0.5 })
  })

  it('does not keep superseded field values when a newer mutation finishes first', () => {
    const assistantId = 'assistant-4'
    const pendingKey = `chat.assistant.settings_patch_pending.${assistantId}` as const
    cacheService.delete(pendingKey)

    const canonical = { ...DEFAULT_ASSISTANT_SETTINGS, temperature: 1 }
    const first = renderHook(({ settings }) => useAssistantPendingSettingsPatch(assistantId, settings), {
      initialProps: { settings: canonical }
    })
    const second = renderHook(({ settings }) => useAssistantPendingSettingsPatch(assistantId, settings), {
      initialProps: { settings: canonical }
    })

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

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.8)
    expect(first.result.current.pendingPatch).toEqual({ temperature: 0.8 })

    act(() => {
      const synced = { ...canonical, temperature: 0.8 }
      first.rerender({ settings: synced })
      second.rerender({ settings: synced })
    })

    expect(first.result.current.effectiveSettings?.temperature).toBe(0.8)
    expect(first.result.current.pendingPatch).toBeUndefined()

    act(() => {
      first.result.current.finishPending(firstVersion)
    })

    expect(first.result.current.effectiveSettings).toEqual({ ...canonical, temperature: 0.8 })
  })
})
