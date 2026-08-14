// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useExpandedState } from '../use-expanded-state'
import { useSelectionState } from '../use-selection-state'

describe('tree-view state hooks', () => {
  it('calls expanded change once outside the uncontrolled state updater', () => {
    const onExpandedChange = vi.fn()
    const { result } = renderHook(() => useExpandedState({ onExpandedChange }))

    act(() => {
      result.current.toggle('root')
    })

    expect(onExpandedChange).toHaveBeenCalledTimes(1)
    expect(Array.from(onExpandedChange.mock.calls[0][0] as ReadonlySet<string>)).toEqual(['root'])
    expect(result.current.isExpanded('root')).toBe(true)
  })

  it('accumulates uncontrolled expanded changes made before rerender', () => {
    const onExpandedChange = vi.fn()
    const { result } = renderHook(() => useExpandedState({ onExpandedChange }))

    act(() => {
      result.current.toggle('root')
      result.current.toggle('child')
    })

    expect(Array.from(onExpandedChange.mock.calls[1][0] as ReadonlySet<string>)).toEqual(['root', 'child'])
    expect(result.current.isExpanded('root')).toBe(true)
    expect(result.current.isExpanded('child')).toBe(true)
  })

  it('does not mutate expanded state locally when controlled', () => {
    const onExpandedChange = vi.fn()
    const { result, rerender } = renderHook(({ expandedIds }) => useExpandedState({ expandedIds, onExpandedChange }), {
      initialProps: { expandedIds: new Set<string>() }
    })

    act(() => {
      result.current.toggle('root')
    })

    expect(onExpandedChange).toHaveBeenCalledTimes(1)
    expect(Array.from(onExpandedChange.mock.calls[0][0] as ReadonlySet<string>)).toEqual(['root'])
    expect(result.current.isExpanded('root')).toBe(false)

    rerender({ expandedIds: new Set(['root']) })
    expect(result.current.isExpanded('root')).toBe(true)
  })

  it('does not mutate selected state locally when controlled', () => {
    const onSelectedChange = vi.fn()
    const { result, rerender } = renderHook(({ selectedId }) => useSelectionState({ selectedId, onSelectedChange }), {
      initialProps: { selectedId: null as string | null }
    })

    act(() => {
      result.current.select('root')
    })

    expect(onSelectedChange).toHaveBeenCalledWith('root')
    expect(result.current.selectedId).toBeNull()
    expect(result.current.isSelected('root')).toBe(false)

    rerender({ selectedId: 'root' })
    expect(result.current.selectedId).toBe('root')
    expect(result.current.isSelected('root')).toBe(true)
  })
})
