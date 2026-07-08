import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  type ConversationCenterResourceDefinition,
  useConversationCenterSurface
} from '../useConversationCenterSurface'

describe('useConversationCenterSurface', () => {
  const definitions = [
    {
      id: 'agent-resource-view',
      kind: 'agent',
      label: 'Agents'
    }
  ] satisfies readonly ConversationCenterResourceDefinition<'agent'>[]

  it('opens and toggles a resource center surface from a menu item', () => {
    const { result } = renderHook(() =>
      useConversationCenterSurface({
        conversationKey: 'session:one',
        resourceDefinitions: definitions
      })
    )

    expect(result.current.activeSurface).toBeNull()
    expect(result.current.resourceMenuItems?.[0]?.active).toBe(false)

    act(() => {
      void result.current.resourceMenuItems?.[0]?.onSelect()
    })

    expect(result.current.activeSurface).toEqual({
      conversationKey: 'session:one',
      kind: 'agent',
      type: 'resource'
    })
    expect(result.current.activeResourceKind).toBe('agent')
    expect(result.current.resourceMenuItems?.[0]?.active).toBe(true)

    act(() => {
      void result.current.resourceMenuItems?.[0]?.onSelect()
    })

    expect(result.current.activeSurface).toBeNull()
    expect(result.current.resourceMenuItems?.[0]?.active).toBe(false)
  })

  it('keeps history and resource surfaces mutually exclusive', () => {
    const { result } = renderHook(() =>
      useConversationCenterSurface({
        conversationKey: 'session:one',
        resourceDefinitions: definitions
      })
    )

    act(() => {
      result.current.openHistory()
    })

    expect(result.current.historyActive).toBe(true)
    expect(result.current.activeResourceKind).toBeNull()

    act(() => {
      void result.current.resourceMenuItems?.[0]?.onSelect()
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

    expect(result.current.activeSurface).toBeNull()
  })

  it('invalidates the active surface when the conversation key changes', () => {
    const { result, rerender } = renderHook(
      ({ conversationKey }) =>
        useConversationCenterSurface({
          conversationKey,
          resourceDefinitions: definitions
        }),
      { initialProps: { conversationKey: 'session:one' } }
    )

    act(() => {
      result.current.openHistory()
    })
    expect(result.current.historyActive).toBe(true)

    rerender({ conversationKey: 'session:two' })

    expect(result.current.activeSurface).toBeNull()
  })

  it('hides menu items and clears the active surface while disabled', () => {
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useConversationCenterSurface({
          conversationKey: 'session:one',
          disabled,
          resourceDefinitions: definitions
        }),
      { initialProps: { disabled: false } }
    )

    act(() => {
      void result.current.resourceMenuItems?.[0]?.onSelect()
    })
    expect(result.current.activeResourceKind).toBe('agent')

    rerender({ disabled: true })

    expect(result.current.activeSurface).toBeNull()
    expect(result.current.resourceMenuItems).toBeUndefined()
  })
})
