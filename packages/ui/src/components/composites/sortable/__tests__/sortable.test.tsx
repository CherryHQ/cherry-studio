// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dndContextCalls: any[] = []

vi.mock('@dnd-kit/core', () => ({
  defaultDropAnimationSideEffects: vi.fn((value) => value),
  DndContext: ({ children, ...props }: { children: ReactNode }) => {
    dndContextCalls.push(props)
    return <div data-testid="dnd-context">{children}</div>
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
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

vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: vi.fn(),
  rectSortingStrategy: vi.fn(),
  SortableContext: ({ children }: { children: ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    isDragging: false,
    listeners: {},
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

  it('resolves function itemStyle for each item wrapper', () => {
    render(
      <Sortable
        items={[{ id: 'a' }, { id: 'b' }]}
        itemKey="id"
        itemStyle={(item, index) => ({
          marginBottom: index + 1,
          paddingTop: item.id === 'b' ? 6 : 2
        })}
        onSortEnd={() => {}}
        renderItem={(item) => <div data-testid={`row-${item.id}`}>{item.id}</div>}
      />
    )

    expect(screen.getByTestId('row-a').parentElement?.parentElement).toHaveStyle({
      marginBottom: '1px',
      paddingTop: '2px'
    })
    expect(screen.getByTestId('row-b').parentElement?.parentElement).toHaveStyle({
      marginBottom: '2px',
      paddingTop: '6px'
    })
  })

  it('resolves function itemStyle for the active drag overlay item', () => {
    render(
      <Sortable
        items={[{ id: 'a' }, { id: 'b' }]}
        itemKey="id"
        itemStyle={(item, index) => ({
          marginBottom: index + 1,
          paddingTop: item.id === 'b' ? 6 : 2
        })}
        onSortEnd={() => {}}
        renderItem={(item) => <div data-testid={`row-${item.id}`}>{item.id}</div>}
      />
    )

    act(() => {
      dndContextCalls[0].onDragStart({ active: { id: 'b' } })
    })

    const overlayRow = within(screen.getByTestId('drag-overlay')).getByTestId('row-b')
    expect(overlayRow.parentElement?.parentElement).toHaveStyle({
      marginBottom: '2px',
      paddingTop: '6px'
    })
  })
})
