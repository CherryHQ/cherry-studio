import { act, render, screen, within } from '@testing-library/react'
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
  activeSortableId: null as null | string,
  droppableData: new Map<string, unknown>(),
  droppableDisabled: new Map<string, boolean | undefined>(),
  onDragCancel: undefined as undefined | ((event: any) => void),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragOver: undefined as undefined | ((event: any) => void),
  onDragStart: undefined as undefined | ((event: any) => void),
  sortableData: new Map<string, unknown>(),
  sortableDisabled: new Map<string, boolean | undefined>(),
  sortableStrategy: undefined as undefined | ((args: any) => unknown),
  verticalListSortingStrategy: vi.fn(() => ({ scaleX: 1, scaleY: 1, x: 0, y: 12 }))
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
    DndContext: ({
      children,
      onDragCancel,
      onDragEnd,
      onDragOver,
      onDragStart
    }: {
      children: ReactNode
      onDragCancel?: any
      onDragEnd?: any
      onDragOver?: any
      onDragStart?: any
    }) => {
      dndMocks.onDragCancel = onDragCancel
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragOver = onDragOver
      dndMocks.onDragStart = onDragStart
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    DragOverlay: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useDroppable: ({ data, disabled, id }: { data: unknown; disabled?: boolean; id: string }) => {
      dndMocks.droppableData.set(id, data)
      dndMocks.droppableDisabled.set(id, disabled)
      return { isOver: false, setNodeRef: vi.fn() }
    },
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children, strategy }: { children: ReactNode; strategy?: (args: any) => unknown }) => {
      dndMocks.sortableStrategy = strategy
      return React.createElement('div', { 'data-testid': 'sortable-context' }, children)
    },
    useSortable: ({ data, disabled, id }: { data: unknown; disabled?: boolean; id: string }) => {
      dndMocks.sortableData.set(id, data)
      dndMocks.sortableDisabled.set(id, disabled)
      return {
        attributes: {},
        isDragging: dndMocks.activeSortableId === id,
        listeners: {},
        setNodeRef: vi.fn(),
        transform: { scaleX: 1, scaleY: 1, x: 0, y: 12 },
        transition: 'transform 200ms ease'
      }
    },
    verticalListSortingStrategy: dndMocks.verticalListSortingStrategy
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (transform: unknown) => (transform ? 'translate3d(0px, 12px, 0px)' : undefined)
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
    footer: 'First',
    items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]
  },
  {
    group: { id: 'second', label: 'Second' },
    header: 'Second',
    footer: 'Second',
    items: [{ id: 'c', label: 'Gamma' }]
  }
]

function renderList(onDragEnd = vi.fn(), extraProps = {}) {
  dndMocks.activeSortableId = null
  dndMocks.droppableData.clear()
  dndMocks.droppableDisabled.clear()
  dndMocks.sortableData.clear()
  dndMocks.sortableDisabled.clear()
  dndMocks.sortableStrategy = undefined
  dndMocks.verticalListSortingStrategy.mockClear()

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

function dragEvent(activeId: string, overId: string, overKind: 'droppable' | 'sortable' = 'sortable') {
  return {
    active: { data: dataFor('sortable', activeId), id: activeId },
    over: { data: dataFor(overKind, overId), id: overId }
  }
}

function dragStartEvent(activeId: string) {
  return {
    active: {
      data: dataFor('sortable', activeId),
      id: activeId,
      rect: { current: { initial: { height: 32, width: 180 }, translated: null } }
    }
  }
}

function startDragging(activeId: string) {
  dndMocks.activeSortableId = activeId
  act(() => {
    dndMocks.onDragStart?.(dragStartEvent(activeId))
  })
}

function getGroupRows(groupLabel: string, itemLabel: string, footerLabel: string) {
  return [
    screen.getByText(groupLabel).parentElement,
    screen.getByText(itemLabel).parentElement,
    screen.getByText(footerLabel).parentElement
  ]
}

function expectRowsBlocked(rows: Array<HTMLElement | null>) {
  for (const row of rows) {
    expect(row).toHaveAttribute('data-drop-blocked', 'true')
    expect(row).toHaveAttribute('data-drop-invalid', 'true')
    expect(row).not.toHaveAttribute('data-drop-allowed')
    expect(row).toHaveClass('cursor-not-allowed', 'opacity-50', '[&_*]:pointer-events-none')
  }
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

  it('does not mark the active group as blocked during group dragging', () => {
    renderList(vi.fn(), {
      dragCapabilities: { groups: true },
      canDragGroup: () => true,
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    act(() => {
      dndMocks.onDragStart?.(dragStartEvent('group:first'))
    })

    const activeHeader = screen.getAllByText('Header First')[0].parentElement
    const activeItem = screen.getByText('Item Alpha').parentElement
    const activeFooter = screen.getByText('Footer First').parentElement

    for (const row of [activeHeader, activeItem, activeFooter]) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
      expect(row).not.toHaveAttribute('data-drop-invalid')
      expect(row).not.toHaveClass('cursor-not-allowed')
    }
    expect(dndMocks.sortableDisabled.get('group:first')).toBe(false)
  })

  it('does not emit group drag payloads when group dragging is disabled', () => {
    const onDragEnd = renderList(vi.fn(), { canDragGroup: () => true })

    expect(() => dataFor('sortable', 'group:first')).toThrow('Expected sortable data for group:first')
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('blocks cross-group item drops when the capability is disabled', () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false } })

    dndMocks.onDragEnd?.(dragEvent('item:a', 'item:c'))

    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('marks blocked groups as invalid when dragging starts', () => {
    const onDragEnd = renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    act(() => {
      dndMocks.onDragStart?.(dragStartEvent('item:a'))
    })

    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))
    expect(screen.getByText('Item Gamma').parentElement).toHaveStyle({ transform: '', transition: '' })

    act(() => {
      dndMocks.onDragEnd?.(dragEvent('item:a', 'item:c'))
    })

    expect(onDragEnd).not.toHaveBeenCalled()
    for (const row of getGroupRows('Header Second', 'Item Gamma', 'Footer Second')) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
      expect(row).not.toHaveAttribute('data-drop-invalid')
    }
  })

  it('renders a drag overlay for the active row while dragging', () => {
    renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false } })

    startDragging('item:a')

    const overlay = screen.getByTestId('drag-overlay')
    expect(within(overlay).getByText('Item Alpha')).toBeInTheDocument()
    expect(overlay.firstElementChild).toHaveStyle({ height: '32px', width: '180px' })
    expect(overlay.firstElementChild).toHaveClass('pointer-events-none')
    expect(overlay.firstElementChild).not.toHaveClass('opacity-85', 'shadow-sm', 'ring-1')
    expect(screen.getAllByText('Item Alpha')[0].parentElement).toHaveStyle({ opacity: '0.5' })
    expect(screen.getAllByText('Item Alpha')[0].parentElement).not.toHaveClass(
      'border-dashed',
      'border-sidebar-border',
      'bg-sidebar-accent/30'
    )

    act(() => {
      dndMocks.onDragCancel?.({})
    })

    expect(screen.getByTestId('drag-overlay')).toBeEmptyDOMElement()
  })

  it('freezes row transforms and shows an insertion line while hovering across groups', () => {
    renderList()

    startDragging('item:a')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:c'))
    })

    const sourceRow = screen.getAllByText('Item Alpha')[0].parentElement
    const sameGroupRow = screen.getByText('Item Beta').parentElement
    const targetRow = screen.getByText('Item Gamma').parentElement

    expect(sourceRow).toHaveStyle({ opacity: '0.5', transform: '', transition: '' })
    expect(sourceRow).not.toHaveClass('border-dashed', 'border-sidebar-border', 'bg-sidebar-accent/30')
    expect(sameGroupRow).toHaveStyle({ transform: '', transition: '' })
    expect(targetRow).toHaveStyle({ transform: '', transition: '' })
    const indicator = targetRow?.querySelector('[data-drop-indicator="after"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('right-2', 'left-2', 'h-0.5', 'bg-sidebar-ring')
    expect(indicator).not.toHaveClass('bg-sidebar-primary', 'bg-sidebar-border')
    expect(within(screen.getByTestId('drag-overlay')).getByText('Item Alpha')).toBeInTheDocument()
  })

  it('freezes row transforms and shows an insertion line while hovering within the same group', () => {
    renderList()

    startDragging('item:a')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:b'))
    })

    const sourceRow = screen.getAllByText('Item Alpha')[0].parentElement
    const targetRow = screen.getByText('Item Beta').parentElement
    const otherGroupRow = screen.getByText('Item Gamma').parentElement

    expect(sourceRow).toHaveStyle({ opacity: '0.5', transform: '', transition: '' })
    expect(sourceRow).not.toHaveClass('border-dashed', 'border-sidebar-border', 'bg-sidebar-accent/30')
    expect(targetRow).toHaveStyle({ transform: '', transition: '' })
    expect(otherGroupRow).toHaveStyle({ transform: '', transition: '' })
    const indicator = targetRow?.querySelector('[data-drop-indicator="after"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('right-2', 'left-2', 'h-0.5', 'bg-sidebar-ring')
    expect(indicator).not.toHaveClass('bg-sidebar-primary', 'bg-sidebar-border')
    expect(within(screen.getByTestId('drag-overlay')).getByText('Item Alpha')).toBeInTheDocument()
  })

  it('uses the latest insertion line position when the drop rect disagrees', () => {
    const onDragEnd = renderList()

    startDragging('item:a')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:b'))
    })

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: dataFor('sortable', 'item:a'),
          id: 'item:a',
          rect: { current: { initial: null, translated: { top: 0, height: 20 } } }
        },
        over: { data: dataFor('sortable', 'item:b'), id: 'item:b', rect: { top: 100, height: 20 } }
      })
    })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ overId: 'b', position: 'after' }))
  })

  it('renders group drops as append indicators at the end of the target group', () => {
    renderList(vi.fn(), { renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div> })

    startDragging('item:a')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'group:second', 'droppable'))
    })

    const targetHeader = screen.getByText('Header Second').parentElement
    const targetItem = screen.getByText('Item Gamma').parentElement
    const targetFooter = screen.getByText('Footer Second').parentElement

    expect(targetHeader).toHaveAttribute('data-drop-target', 'true')
    expect(targetHeader?.querySelector('[data-drop-indicator]')).not.toBeInTheDocument()
    expect(targetItem?.querySelector('[data-drop-indicator]')).not.toBeInTheDocument()
    const indicator = targetFooter?.querySelector('[data-drop-indicator="before"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('right-2', 'left-2', 'h-0.5', 'bg-sidebar-ring')
    expect(indicator).not.toHaveClass('bg-sidebar-primary', 'bg-sidebar-border')
  })

  it('disables sortable projection and shows insertion lines for item and group drags', () => {
    renderList(vi.fn(), { dragCapabilities: { groups: true }, canDragGroup: () => true })

    startDragging('item:a')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:c'))
    })

    expect(
      dndMocks.sortableStrategy?.({
        activeIndex: 0,
        activeNodeRect: null,
        index: 1,
        overIndex: 2,
        rects: []
      })
    ).toBeNull()
    expect(dndMocks.verticalListSortingStrategy).not.toHaveBeenCalled()

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:b'))
    })

    expect(
      dndMocks.sortableStrategy?.({
        activeIndex: 0,
        activeNodeRect: null,
        index: 1,
        overIndex: 1,
        rects: []
      })
    ).toBeNull()
    expect(dndMocks.verticalListSortingStrategy).not.toHaveBeenCalled()

    startDragging('group:first')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('group:first', 'group:second'))
    })

    expect(
      dndMocks.sortableStrategy?.({
        activeIndex: 0,
        activeNodeRect: null,
        index: 1,
        overIndex: 3,
        rects: []
      })
    ).toBeNull()
    expect(dndMocks.verticalListSortingStrategy).not.toHaveBeenCalled()

    const targetRow = screen.getByText('Item Gamma').parentElement
    const indicator = targetRow?.querySelector('[data-drop-indicator="after"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('right-2', 'left-2', 'h-0.5', 'bg-sidebar-ring')
  })

  it('shows the group insertion line before the target group when moving upward', () => {
    renderList(vi.fn(), { dragCapabilities: { groups: true }, canDragGroup: () => true })

    startDragging('group:second')

    act(() => {
      dndMocks.onDragOver?.(dragEvent('group:second', 'group:first'))
    })

    const targetHeader = screen.getByText('Header First').parentElement
    const indicator = targetHeader?.querySelector('[data-drop-indicator="before"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('right-2', 'left-2', 'h-0.5', 'bg-sidebar-ring')
  })

  it('keeps same-group item drops enabled independently from cross-group drops', () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false, itemSameGroup: true } })

    dndMocks.onDragEnd?.({
      active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
      over: { data: dataFor('sortable', 'item:b'), id: 'item:b' }
    })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: 'first', targetGroupId: 'first' }))
  })

  it('keeps blocked groups stable while moving back to an allowed target', () => {
    const onDragEnd = renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false, itemSameGroup: true },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    act(() => {
      dndMocks.onDragStart?.(dragStartEvent('item:a'))
    })

    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:c'))
    })

    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'item:b'))
    })

    const targetHeader = screen.getByText('Header First').parentElement
    const targetItem = screen.getByText('Item Beta').parentElement
    const targetFooter = screen.getByText('Footer First').parentElement

    expect(targetHeader).not.toHaveAttribute('data-drop-allowed')
    expect(targetItem).toHaveAttribute('data-drop-target', 'true')
    expect(targetItem).toHaveAttribute('data-drop-allowed', 'true')
    expect(targetItem).not.toHaveAttribute('data-drop-invalid')
    expect(targetItem).not.toHaveClass('cursor-not-allowed')
    expect(targetFooter).not.toHaveAttribute('data-drop-allowed')
    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    act(() => {
      dndMocks.onDragEnd?.(dragEvent('item:a', 'item:b'))
    })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: 'first', targetGroupId: 'first' }))
    for (const targetRow of [targetHeader, targetItem, targetFooter]) {
      expect(targetRow).not.toHaveAttribute('data-drop-target')
    }
    for (const row of getGroupRows('Header Second', 'Item Gamma', 'Footer Second')) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
    }
  })

  it('keeps blocked group state when drag over leaves a target and clears it on cancel', () => {
    renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    act(() => {
      dndMocks.onDragStart?.(dragStartEvent('item:a'))
    })

    const blockedRows = getGroupRows('Header Second', 'Item Gamma', 'Footer Second')
    expectRowsBlocked(blockedRows)
    expect(dndMocks.droppableDisabled.get('group:second')).toBe(true)
    expect(dndMocks.droppableDisabled.get('group-footer:second')).toBe(true)
    expect(dndMocks.droppableDisabled.get('group:first')).toBe(false)
    expect(dndMocks.droppableDisabled.get('group-footer:first')).toBe(false)
    expect(dndMocks.sortableDisabled.get('item:c')).toBe(true)
    expect(dndMocks.sortableDisabled.get('item:b')).toBe(false)

    act(() => {
      dndMocks.onDragOver?.({
        active: { data: dataFor('sortable', 'item:a'), id: 'item:a' },
        over: null
      })
    })

    expectRowsBlocked(blockedRows)

    act(() => {
      dndMocks.onDragOver?.(dragEvent('item:a', 'group:second', 'droppable'))
    })

    for (const row of blockedRows) {
      expect(row).not.toHaveAttribute('data-drop-target')
      expect(row).not.toHaveAttribute('data-drop-allowed')
    }
    expect(dndMocks.droppableDisabled.get('group:second')).toBe(true)
    expect(dndMocks.droppableDisabled.get('group-footer:second')).toBe(true)
    expect(dndMocks.sortableDisabled.get('item:c')).toBe(true)

    act(() => {
      dndMocks.onDragCancel?.({})
    })

    for (const targetRow of blockedRows) {
      expect(targetRow).not.toHaveAttribute('data-drop-blocked')
      expect(targetRow).not.toHaveAttribute('data-drop-invalid')
    }
    expect(dndMocks.droppableDisabled.get('group:second')).toBe(false)
    expect(dndMocks.droppableDisabled.get('group-footer:second')).toBe(false)
    expect(dndMocks.sortableDisabled.get('item:c')).toBe(false)
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
