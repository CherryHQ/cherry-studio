// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTreeDragAndDrop } from '../use-tree-drag-and-drop'

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
  it.each(['HTML', 'SVG'])('clones the %s drag image without mutating the source', async (kind) => {
    const source =
      kind === 'SVG' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('div')
    const content =
      kind === 'SVG' ? document.createElementNS('http://www.w3.org/2000/svg', 'text') : document.createElement('span')
    content.textContent = 'Tree row'
    source.appendChild(content)
    source.style.cssText = 'width: 11px !important; color: red'
    document.body.appendChild(source)
    const measure = vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 30))
    let ghost: Element | undefined

    try {
      const { result } = renderHook(() => useTreeDragAndDrop({ onMove: vi.fn() }))
      const event = makeDragEvent()
      const setDragImage = vi.fn<DataTransfer['setDragImage']>()
      event.currentTarget = source
      event.dataTransfer.setDragImage = setDragImage

      act(() => result.current.getDragHandleProps('row').onDragStart(event))

      ghost = setDragImage.mock.calls[0]?.[0]
      expect(ghost).not.toBe(source)
      if (!(ghost instanceof HTMLElement) && !(ghost instanceof SVGElement)) {
        throw new Error('Expected a cloned drag image')
      }
      expect(ghost.textContent).toBe('Tree row')
      expect(ghost.style.width).toBe('240px')
      expect(ghost.style.color).toBe('red')
      expect(source.style.width).toBe('11px')
      expect(source.style.getPropertyPriority('width')).toBe('important')
      const image = ghost
      await waitFor(() => expect(image.isConnected).toBe(false))
    } finally {
      ghost?.remove()
      source.remove()
      measure.mockRestore()
    }
  })

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
    const sourceHandles = result.current.getDragHandleProps('source')
    act(() => {
      sourceHandles.onDragStart(makeDragEvent({ data: 'source' }))
    })
    const handles = result.current.getDragHandleProps('target')
    act(() => {
      handles.onDragOver(makeDragEvent({ clientY: 5 }))
    })
    act(() => {
      handles.onDrop(makeDragEvent({ data: 'spoofed' }))
    })
    expect(onMove).toHaveBeenCalledWith('source', 'target', 'before')
  })

  it('ignores external drops without an active internal drag', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('target')

    act(() => {
      handles.onDrop(makeDragEvent({ data: 'external' }))
    })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('falls back to after on leaf drop without a prior dragOver', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() =>
      useTreeDragAndDrop({
        onMove,
        canHaveChildren: () => false
      })
    )
    const sourceHandles = result.current.getDragHandleProps('source')
    act(() => {
      sourceHandles.onDragStart(makeDragEvent({ data: 'source' }))
    })
    const targetHandles = result.current.getDragHandleProps('leaf')

    act(() => {
      targetHandles.onDrop(makeDragEvent())
    })

    expect(onMove).toHaveBeenCalledWith('source', 'leaf', 'after')
  })

  it('falls back to inside on container drop without a prior dragOver', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() =>
      useTreeDragAndDrop({
        onMove,
        canHaveChildren: () => true
      })
    )
    const sourceHandles = result.current.getDragHandleProps('source')
    act(() => {
      sourceHandles.onDragStart(makeDragEvent({ data: 'source' }))
    })
    const targetHandles = result.current.getDragHandleProps('container')

    act(() => {
      targetHandles.onDrop(makeDragEvent())
    })

    expect(onMove).toHaveBeenCalledWith('source', 'container', 'inside')
  })

  it('falls back to inside when canHaveChildren is omitted', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const sourceHandles = result.current.getDragHandleProps('source')
    act(() => {
      sourceHandles.onDragStart(makeDragEvent({ data: 'source' }))
    })
    const targetHandles = result.current.getDragHandleProps('target')

    act(() => {
      targetHandles.onDrop(makeDragEvent())
    })

    expect(onMove).toHaveBeenCalledWith('source', 'target', 'inside')
  })

  it('ignores self-drop', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useTreeDragAndDrop({ onMove }))
    const handles = result.current.getDragHandleProps('same')
    act(() => {
      handles.onDragStart(makeDragEvent({ data: 'same' }))
    })
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
