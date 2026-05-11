import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: 40
      })),
    getTotalSize: () => options.count * 40,
    measureElement: vi.fn(),
    scrollElement: null
  }))
}))

const dndMocks = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragStart: undefined as undefined | ((event: any) => void)
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer
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
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sortable-context' }, children),
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: ({ id }: { id: string }) => ({
      attributes: { 'data-sortable-id': id },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false
    }),
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

import { ResourceList, useResourceList } from '../ResourceList'
import type { ResourceListItemBase } from '../ResourceListContext'
import {
  AgentResourceList,
  AssistantResourceList,
  HistoryResourceList,
  SessionResourceList,
  TopicResourceList
} from '../variants'

type TestItem = ResourceListItemBase & {
  kind: 'session' | 'topic'
  pinned?: boolean
  updatedAt: number
}

const ITEMS: TestItem[] = [
  { id: 'alpha', name: 'Alpha', kind: 'session', pinned: false, updatedAt: 1 },
  { id: 'beta', name: 'Beta', kind: 'session', pinned: true, updatedAt: 3 },
  { id: 'gamma', name: 'Gamma', kind: 'topic', pinned: true, updatedAt: 2 }
]

function Inspector() {
  const { state, view } = useResourceList<TestItem>()
  return (
    <output data-testid="inspector">
      {JSON.stringify({
        query: state.query,
        selectedId: state.selectedId,
        renamingId: state.renamingId,
        names: view.items.map((item) => item.name),
        groups: view.groups.map((group) => group.group.id)
      })}
    </output>
  )
}

describe('ResourceList', () => {
  it('derives search, filter, sort, and group state without mutating items', () => {
    const originalOrder = ITEMS.map((item) => item.id).join(',')
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        defaultSortId="updated"
        filterOptions={[
          {
            id: 'pinned',
            label: 'Pinned',
            predicate: (item) => item.pinned === true
          }
        ]}
        sortOptions={[
          {
            id: 'updated',
            label: 'Updated',
            comparator: (a, b) => b.updatedAt - a.updatedAt
          }
        ]}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}>
        <ResourceList.Frame>
          <ResourceList.Search placeholder="Search resources" />
          <ResourceList.FilterBar />
          <Inspector />
          <ResourceList.VirtualItems
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'ga' } })

    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      query: 'ga',
      names: ['Gamma'],
      groups: ['topic']
    })

    fireEvent.click(screen.getByText('Gamma'))
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      selectedId: 'gamma'
    })
    expect(ITEMS.map((item) => item.id).join(',')).toBe(originalOrder)
  })

  it('owns rename UI state and delegates persistence through callbacks', () => {
    const onRenameItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ item }: { item: TestItem }) {
      const { actions } = useResourceList<TestItem>()
      return (
        <ResourceList.Item item={item}>
          <ResourceList.RenameField item={item} aria-label={`Rename ${item.name}`} />
          <span>{item.name}</span>
          <button type="button" onClick={() => actions.startRename(item.id)}>
            Rename {item.name}
          </button>
        </ResourceList.Item>
      )
    }

    render(
      <Provider items={ITEMS} onRenameItem={onRenameItem}>
        <ResourceList.Frame>
          <Inspector />
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rename Alpha' }))
    const input = screen.getByLabelText('Rename Alpha')
    fireEvent.change(input, { target: { value: 'Renamed Alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameItem).toHaveBeenCalledWith('alpha', 'Renamed Alpha')
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      renamingId: null
    })
  })

  it('renders context menu actions and calls reorder from explicit draggable composition', () => {
    const onRenameItem = vi.fn()
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ item }: { item: TestItem }) {
      const { actions } = useResourceList<TestItem>()
      return (
        <ResourceList.ContextMenu
          item={item}
          content={<ResourceList.ContextMenuRenameAction item={item} label="Rename" />}>
          <ResourceList.Item item={item}>
            <ResourceList.RenameField item={item} aria-label={`Rename ${item.name}`} />
            <span>{item.name}</span>
            <button type="button" onClick={() => actions.startRename(item.id)}>
              Rename inline
            </button>
          </ResourceList.Item>
        </ResourceList.ContextMenu>
      )
    }

    render(
      <Provider items={ITEMS} onRenameItem={onRenameItem} onReorder={onReorder}>
        <ResourceList.Frame>
          <ResourceList.DraggableItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
    expect(screen.getByLabelText('Rename Alpha')).toBeInTheDocument()

    dndMocks.onDragEnd?.({ active: { id: 'alpha' }, over: { id: 'gamma' } })
    expect(onReorder).toHaveBeenCalledWith({ activeId: 'alpha', overId: 'gamma', position: 'after' })
  })

  it('exposes explicit business variants without a shared mode prop', () => {
    const variants = [
      ['session', SessionResourceList],
      ['topic', TopicResourceList],
      ['agent', AgentResourceList],
      ['assistant', AssistantResourceList],
      ['history', HistoryResourceList]
    ] as const

    for (const [name, Component] of variants) {
      const { unmount } = render(
        <Component items={[{ id: `${name}-1`, name: `${name} item` }]}>
          <ResourceList.VirtualItems
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </Component>
      )

      expect(within(screen.getByTestId(`resource-list-${name}`)).getByText(`${name} item`)).toBeInTheDocument()
      unmount()
    }
  })
})
