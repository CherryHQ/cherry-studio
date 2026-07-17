// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dndContextCalls: any[] = []
const dragOverlayCalls: any[] = []

vi.mock('@dnd-kit/core', () => ({
  defaultDropAnimationSideEffects: vi.fn((value) => value),
  DndContext: ({ children, ...props }: { children: ReactNode }) => {
    dndContextCalls.push(props)
    return <div data-testid="dnd-context">{children}</div>
  },
  DragOverlay: ({ children, ...props }: { children: ReactNode }) => {
    dragOverlayCalls.push(props)
    return <div data-testid="drag-overlay">{children}</div>
  },
  KeyboardSensor: vi.fn(),
  PointerSensor: class PointerSensor {},
  TouchSensor: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  useSensors: vi.fn((...sensors) => sensors)
}))

vi.mock('@dnd-kit/modifiers', () => ({
  restrictToFirstScrollableAncestor: vi.fn(),
  restrictToHorizontalAxis: vi.fn(),
  restrictToVerticalAxis: vi.fn(),
  restrictToWindowEdges: vi.fn()
}))

const activatorNodeRef = vi.fn()

vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: vi.fn(),
  rectSortingStrategy: vi.fn(),
  SortableContext: ({ children }: { children: ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: { role: 'button', 'aria-roledescription': 'sortable' },
    isDragging: false,
    listeners: { onKeyDown: vi.fn() },
    setActivatorNodeRef: activatorNodeRef,
    setNodeRef: vi.fn(),
    transition: null,
    transform: null
  })),
  verticalListSortingStrategy: vi.fn()
}))

import Sortable from '../sortable'

describe('Sortable', () => {
  beforeEach(() => {
    dndContextCalls.length = 0
    dragOverlayCalls.length = 0
    vi.clearAllMocks()
  })

  it('passes custom collision detection to DndContext', () => {
    const collisionDetection = vi.fn()

    render(
      <Sortable
        items={[{ id: 'a' }]}
        itemKey="id"
        collisionDetection={collisionDetection}
        onSortEnd={() => {}}
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    expect(dndContextCalls[0].collisionDetection).toBe(collisionDetection)
  })

  it('forwards adjustScale to the DragOverlay (defaults to true)', () => {
    render(
      <Sortable items={[{ id: 'a' }]} itemKey="id" onSortEnd={() => {}} renderItem={(item) => <div>{item.id}</div>} />
    )

    expect(dragOverlayCalls[0].adjustScale).toBe(true)
  })

  it('forwards adjustScale={false} to the DragOverlay', () => {
    render(
      <Sortable
        items={[{ id: 'a' }]}
        itemKey="id"
        adjustScale={false}
        onSortEnd={() => {}}
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    expect(dragOverlayCalls[0].adjustScale).toBe(false)
  })

  it('passes overlay:false to in-list items and overlay:true to the drag-overlay copy', () => {
    const states: Array<{ dragging: boolean; overlay: boolean }> = []
    const renderItem = (item: { id: string }, state: { dragging: boolean; overlay: boolean }) => {
      states.push(state)
      return <div>{item.id}</div>
    }

    render(<Sortable items={[{ id: 'a' }, { id: 'b' }]} itemKey="id" onSortEnd={() => {}} renderItem={renderItem} />)

    // Initial render: every in-list item gets overlay:false.
    expect(states.length).toBeGreaterThan(0)
    expect(states.every((state) => state.overlay === false)).toBe(true)

    act(() => {
      dndContextCalls[0].onDragStart({ active: { id: 'a' } })
    })

    // After drag start, the overlay copy renders with overlay:true.
    expect(states.some((state) => state.overlay === true)).toBe(true)
  })

  it('binds the drag activator to the whole row in default mode', () => {
    const states: Array<{ dragHandleProps?: unknown }> = []

    render(
      <Sortable
        items={[{ id: 'a' }]}
        itemKey="id"
        onSortEnd={() => {}}
        renderItem={(item, state) => {
          states.push(state)
          return <div>{item.id}</div>
        }}
      />
    )

    // No handle props are handed to renderItem; the activator attributes/listeners
    // land on the sortable row itself.
    expect(states.every((state) => state.dragHandleProps === undefined)).toBe(true)
    expect(document.querySelector('[aria-roledescription="sortable"]')).not.toBeNull()
  })

  it('routes the drag activator to a handle in dragHandle mode, leaving the row inert', () => {
    let captured: any

    render(
      <Sortable
        items={[{ id: 'a' }]}
        itemKey="id"
        dragHandle
        onSortEnd={() => {}}
        renderItem={(item, state) => {
          captured = state.dragHandleProps
          return (
            <div>
              <button type="button" ref={state.dragHandleProps?.ref} {...state.dragHandleProps?.attributes}>
                handle
              </button>
              {item.id}
            </div>
          )
        }}
      />
    )

    // Handle props carry the activator; the row no longer spreads them.
    expect(captured).toMatchObject({ attributes: { 'aria-roledescription': 'sortable' } })
    expect(captured.ref).toBe(activatorNodeRef)
    // Only the handle button carries the activator role, not a wrapping row element.
    const activator = document.querySelector('[aria-roledescription="sortable"]')
    expect(activator?.tagName).toBe('BUTTON')
    expect(screen.getByRole('button', { name: 'handle' })).toBe(activator)
  })

  it('forwards accessibility (announcements / screen-reader instructions) to DndContext', () => {
    const accessibility = { screenReaderInstructions: { draggable: '拖动排序' } }

    render(
      <Sortable
        items={[{ id: 'a' }]}
        itemKey="id"
        accessibility={accessibility}
        onSortEnd={() => {}}
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    expect(dndContextCalls[0].accessibility).toBe(accessibility)
  })
})
