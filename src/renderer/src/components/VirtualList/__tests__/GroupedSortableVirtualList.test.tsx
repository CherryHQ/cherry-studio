import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: options.estimateSize(index)
      })),
    getTotalSize: () => options.count * 40,
    getVirtualIndexes: vi.fn(() => Array.from({ length: options.count }, (_, index) => index)),
    measure: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn(),
    scrollElement: null,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn()
  }))
}))

const dndMocks = vi.hoisted(() => ({
  droppableData: new Map<string, unknown>(),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragStart: undefined as undefined | ((event: any) => void),
  sortableData: new Map<string, unknown>()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

vi.mock('@dnd-kit/core', () => {
  const React = require('react')
  return {
    DndContext: ({ children, onDragEnd, onDragStart }: { children: ReactNode; onDragEnd?: any; onDragStart?: any }) => {
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragStart = onDragStart
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useDroppable: ({ data, id }: { data: unknown; id: string }) => {
      dndMocks.droppableData.set(id, data)
      return { isOver: false, setNodeRef: vi.fn() }
    },
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sortable-context' }, children),
    useSortable: ({ data, id }: { data: unknown; id: string }) => {
      dndMocks.sortableData.set(id, data)
      return {
        attributes: {},
        isDragging: false,
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined
      }
    },
    verticalListSortingStrategy: {}
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined
    }
  }
}))

import { GroupedSortableVirtualList } from '..'

type TestGroup = {
  id: string
  label: string
}

type TestItem = {
  id: string
  label: string
}

const groups = [
  {
    group: { id: 'first', label: 'First' },
    header: 'First',
    items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]
  },
  {
    group: { id: 'second', label: 'Second' },
    header: 'Second',
    items: [{ id: 'c', label: 'Gamma' }]
  }
]

function renderList(onDragEnd = vi.fn(), extraProps = {}) {
  dndMocks.droppableData.clear()
  dndMocks.sortableData.clear()

  render(
    <GroupedSortableVirtualList<TestGroup, TestItem, string>
      groups={groups}
      getGroupId={(group) => group.id}
      getItemId={(item) => item.id}
      estimateGroupHeaderSize={() => 24}
      estimateItemSize={() => 40}
      renderGroupHeader={(header) => <div>Header {header}</div>}
      renderItem={(item) => <div>Item {item.label}</div>}
      onDragEnd={onDragEnd}
      {...extraProps}
    />
  )

  return onDragEnd
}

function dataFor(kind: 'droppable' | 'sortable', id: string) {
  const data = kind === 'droppable' ? dndMocks.droppableData.get(id) : dndMocks.sortableData.get(id)
  if (!data) {
    throw new Error(`Expected ${kind} data for ${id}`)
  }
  return { current: data }
}

describe('GroupedSortableVirtualList', () => {
  it('emits same-group item drag payloads', () => {
    const onDragEnd = renderList()

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
      over: { data: dataFor('sortable', 'item:b'), id: 'item:b' }
    })

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'a',
        overId: 'b',
        overType: 'item',
        position: 'after',
        sourceGroupId: 'first',
        sourceIndex: 0,
        targetGroupId: 'first',
        targetIndex: 1,
        type: 'item'
      })
    )
  })

  it('emits cross-group item drops against a group header', () => {
    const onDragEnd = renderList()

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
      over: { data: dataFor('droppable', 'group:second'), id: 'group:second' }
    })

    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'a',
        overId: 'second',
        overType: 'group',
        sourceGroupId: 'first',
        targetGroupId: 'second',
        targetIndex: 0,
        type: 'item'
      })
    )
  })

  it('can emit group drag payloads when group dragging is enabled', () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { groups: true }, canDragGroup: () => true })

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'group:first'), id: 'group:first' },
      over: { data: dataFor('sortable', 'group:second'), id: 'group:second' }
    })

    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeGroupId: 'first',
        overGroupId: 'second',
        overType: 'group',
        sourceIndex: 0,
        targetIndex: 1,
        type: 'group'
      })
    )
  })

  it('does not emit group drag payloads when group dragging is disabled', () => {
    const onDragEnd = renderList(vi.fn(), { canDragGroup: () => true })

    expect(() => dataFor('sortable', 'group:first')).toThrow('Expected sortable data for group:first')
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('blocks cross-group item drops when the capability is disabled', () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false } })

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
      over: { data: dataFor('sortable', 'item:c'), id: 'item:c' }
    })

    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('keeps same-group item drops enabled independently from cross-group drops', () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false, itemSameGroup: true } })

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
      over: { data: dataFor('sortable', 'item:b'), id: 'item:b' }
    })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: 'first', targetGroupId: 'first' }))
  })

  it('uses the dragged row center to resolve before or after item drops', () => {
    const onDragEnd = renderList()

    dndMocks.onDragEnd?.({
      active: {
        data: dataFor('sortable', 'item:a'),
        id: 'item:a',
        rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
      },
      over: { data: dataFor('sortable', 'item:b'), id: 'item:b', rect: { top: 80, height: 20 } }
    })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ position: 'before' }))
  })
})
