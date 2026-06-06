// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
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
})
