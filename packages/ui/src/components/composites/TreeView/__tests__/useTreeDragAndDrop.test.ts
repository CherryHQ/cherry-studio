// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTreeDragAndDrop } from '../useTreeDragAndDrop'

function makeDragEvent(overrides: Partial<{ clientY: number; rect: DOMRect; data: string }> = {}) {
  const rect = overrides.rect ?? ({ top: 0, bottom: 100, height: 100, left: 0, right: 100 } as DOMRect)
  const data: Record<string, string> = overrides.data !== undefined ? { 'text/plain': overrides.data } : {}
  return {
    clientY: overrides.clientY ?? 50,
    preventDefault: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => rect,
      parentElement: null,
      cloneNode: () => ({ style: {} })
    },
    dataTransfer: {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((k: string, v: string) => {
        data[k] = v
      }),
      getData: (k: string) => data[k] ?? '',
      setDragImage: vi.fn()
    }
  } as unknown as React.DragEvent
}

describe('useTreeDragAndDrop', () => {
  it('returns no-op handlers when onMove is undefined', () => {
    const { result } = renderHook(() => useTreeDragAndDrop({}))
    const handles = result.current.getDragHandleProps('a')
    expect(handles.draggable).toBe(false)
  })

  it('reports "before" when cursor in top zone', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 5 }))
    })
    expect(result.current.dragPosition).toBe('before')
    expect(result.current.dragOverId).toBe('target')
  })

  it('reports "after" when cursor in bottom zone', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 95 }))
    })
    expect(result.current.dragPosition).toBe('after')
  })

  it('reports "inside" by default in middle zone', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 50 }))
    })
    expect(result.current.dragPosition).toBe('inside')
  })

  it('substitutes "after" for "inside" when canHaveChildren returns false', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() =>
      useTreeDragAndDrop({
        onMove,
        canHaveChildren: () => false
      })
    )
    const handles = result.current.getDragHandleProps('leaf')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 50 }))
    })
    expect(result.current.dragPosition).toBe('after')
  })

  it('calls onMove on drop with computed position', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 5 }))
    })
    act(() => {
      handles.onDrop(makeDragEvent({ data: 'source' }))
    })
    expect(onMove).toHaveBeenCalledWith('source', 'target', 'before')
  })

  it('ignores self-drop', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('same')
    act(() => {
      handles.onDrop(makeDragEvent({ data: 'same' }))
    })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('clears drag state on dragEnd', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 5 }))
    })
    expect(result.current.dragOverId).toBe('target')
    act(() => {
      handles.onDragEnd(makeDragEvent())
    })
    expect(result.current.dragOverId).toBeNull()
    expect(result.current.dragPosition).toBeNull()
  })
})
