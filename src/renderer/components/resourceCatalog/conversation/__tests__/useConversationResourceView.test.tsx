import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type ConversationResourceViewDefinition, useConversationResourceView } from '../useConversationResourceView'

describe('useConversationResourceView', () => {
  const definitions = [
    {
      id: 'agent-resource-view',
      kind: 'agent',
      label: 'Agents'
    }
  ] satisfies readonly ConversationResourceViewDefinition<'agent'>[]

  it('opens a resource center view from a menu item', () => {
    const { result } = renderHook(() =>
      useConversationResourceView({
        conversationKey: 'session:one',
        definitions
      })
    )

    expect(result.current.activeKind).toBeNull()
    expect(result.current.menuItems?.[0]?.active).toBe(false)

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })

    expect(result.current.activeKind).toBe('agent')
    expect('centerView' in result.current).toBe(false)
    expect(result.current.menuItems?.[0]?.active).toBe(true)
  })

  it('closes the active resource center view when selecting the active menu item again', () => {
    const { result } = renderHook(() =>
      useConversationResourceView({
        conversationKey: 'session:one',
        definitions
      })
    )

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })
    expect(result.current.activeKind).toBe('agent')

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })

    expect(result.current.activeKind).toBeNull()
    expect(result.current.menuItems?.[0]?.active).toBe(false)
  })

  it('invalidates the active resource view when the conversation key changes', () => {
    const { result, rerender } = renderHook(
      ({ conversationKey }) =>
        useConversationResourceView({
          conversationKey,
          definitions
        }),
      { initialProps: { conversationKey: 'session:one' } }
    )

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })
    expect(result.current.activeKind).toBe('agent')

    rerender({ conversationKey: 'session:two' })

    expect(result.current.activeKind).toBeNull()
    expect('centerView' in result.current).toBe(false)
  })

  it('hides menu items and clears the active kind while disabled', () => {
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useConversationResourceView({
          conversationKey: 'session:one',
          definitions,
          disabled
        }),
      { initialProps: { disabled: false } }
    )

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })
    expect(result.current.activeKind).toBe('agent')

    rerender({ disabled: true })

    expect(result.current.activeKind).toBeNull()
    expect(result.current.menuItems).toBeUndefined()
  })

  it('invalidates the active resource view when its definition is removed', () => {
    const { result, rerender } = renderHook(
      ({ definitions }) =>
        useConversationResourceView({
          conversationKey: 'session:one',
          definitions
        }),
      {
        initialProps: {
          definitions: [
            {
              id: 'agent-resource-view',
              kind: 'agent',
              label: 'Agents'
            },
            {
              id: 'skill-resource-view',
              kind: 'skill',
              label: 'Skills'
            }
          ] satisfies readonly ConversationResourceViewDefinition<'agent' | 'skill'>[]
        }
      }
    )

    act(() => {
      void result.current.menuItems?.[0]?.onSelect()
    })
    expect(result.current.activeKind).toBe('agent')

    rerender({
      definitions: [
        {
          id: 'skill-resource-view',
          kind: 'skill',
          label: 'Skills'
        }
      ]
    })

    expect(result.current.activeKind).toBeNull()
    expect('centerView' in result.current).toBe(false)
  })
})
