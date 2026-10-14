import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useConversationCenterSurface } from '../useConversationCenterSurface'

describe('useConversationCenterSurface', () => {
  const resourceKinds = ['agent'] as const

  it('opens and toggles a resource center surface', () => {
    const { result } = renderHook(() =>
      useConversationCenterSurface({
        conversationKey: 'session:one',
        resourceKinds
      })
    )

    expect(result.current.activeResourceKind).toBeNull()
    expect(result.current.historyActive).toBe(false)

    act(() => {
      result.current.toggleResource('agent')
    })

    expect(result.current.activeResourceKind).toBe('agent')
    expect(result.current.historyActive).toBe(false)

    act(() => {
      result.current.toggleResource('agent')
    })

    expect(result.current.activeResourceKind).toBeNull()
    expect(result.current.historyActive).toBe(false)
  })

  it('keeps history and resource surfaces mutually exclusive', () => {
    const { result } = renderHook(() =>
      useConversationCenterSurface({
        conversationKey: 'session:one',
        resourceKinds
      })
    )

    act(() => {
      result.current.toggleHistory()
    })

    expect(result.current.historyActive).toBe(true)
    expect(result.current.activeResourceKind).toBeNull()

    act(() => {
      result.current.toggleResource('agent')
    })

    expect(result.current.historyActive).toBe(false)
    expect(result.current.activeResourceKind).toBe('agent')

    act(() => {
      result.current.toggleHistory()
    })

    expect(result.current.historyActive).toBe(true)
    expect(result.current.activeResourceKind).toBeNull()

    act(() => {
      result.current.toggleHistory()
    })

    expect(result.current.historyActive).toBe(false)
    expect(result.current.activeResourceKind).toBeNull()
  })

  it('keeps history open when the conversation key changes', () => {
    const { result, rerender } = renderHook(
      ({ conversationKey }) =>
        useConversationCenterSurface({
          conversationKey,
          resourceKinds
        }),
      { initialProps: { conversationKey: 'session:one' } }
    )

    act(() => {
      result.current.toggleHistory()
    })
    expect(result.current.historyActive).toBe(true)

    rerender({ conversationKey: 'session:two' })

    expect(result.current.historyActive).toBe(true)
    act(() => result.current.toggleHistory())
    expect(result.current.historyActive).toBe(false)
    expect(result.current.activeResourceKind).toBeNull()
  })

  it('invalidates a resource surface when the conversation changes', () => {
    const { result, rerender } = renderHook(
      ({ conversationKey }) => useConversationCenterSurface({ conversationKey, resourceKinds }),
      { initialProps: { conversationKey: 'session:one' } }
    )
    act(() => result.current.toggleResource('agent'))
    rerender({ conversationKey: 'session:two' })
    expect(result.current.activeResourceKind).toBeNull()
    expect(result.current.historyActive).toBe(false)
  })

  it('clears the active surface while disabled', () => {
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useConversationCenterSurface({
          conversationKey: 'session:one',
          disabled,
          resourceKinds
        }),
      { initialProps: { disabled: false } }
    )

    act(() => {
      result.current.toggleResource('agent')
    })
    expect(result.current.activeResourceKind).toBe('agent')

    rerender({ disabled: true })

    expect(result.current.activeResourceKind).toBeNull()
    expect(result.current.historyActive).toBe(false)
  })
})
