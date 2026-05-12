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
  AssistantListV2,
  AssistantResourceList,
  createAssistantListActionRegistry,
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

  it('combines virtualization and drag reorder for large resource lists', () => {
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} onReorder={onReorder}>
        <ResourceList.Frame>
          <ResourceList.VirtualDraggableItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        count: ITEMS.length,
        overscan: 6
      })
    )

    dndMocks.onDragEnd?.({ active: { id: 'beta' }, over: { id: 'alpha' } })
    expect(onReorder).toHaveBeenCalledWith({ activeId: 'beta', overId: 'alpha', position: 'after' })
  })

  it('renders grouped virtual rows with group counts', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) =>
          item.pinned ? { id: 'pinned', label: 'Pinned', count: 2 } : { id: 'regular', label: 'Regular', count: 1 }
        }>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('Regular')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        count: ITEMS.length + 2
      })
    )
  })

  it('provides shared header, search, and item presentation parts', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS}>
        <ResourceList.Frame>
          <ResourceList.Header
            title="Resources"
            count={ITEMS.length}
            actions={<ResourceList.HeaderActionButton aria-label="Filter" />}>
            <ResourceList.Search placeholder="Search resources" />
          </ResourceList.Header>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <ResourceList.ItemIcon data-testid={`${item.id}-icon`} />
                <ResourceList.ItemTitle>{item.name}</ResourceList.ItemTitle>
                <ResourceList.ItemAction aria-label={`Action ${item.name}`} />
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Resources')).toBeInTheDocument()
    expect(screen.getByText(String(ITEMS.length))).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search resources')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    expect(screen.getByTestId('alpha-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action Alpha' })).toBeInTheDocument()
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

  it('builds assistant list menu actions without putting business logic in ResourceList', async () => {
    const handlers = {
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn()
    }
    const registry = createAssistantListActionRegistry<TestItem>(handlers, {
      select: 'Select',
      pin: 'Pin',
      unpin: 'Unpin',
      edit: 'Edit',
      delete: 'Delete'
    })
    const item = ITEMS[0]
    const context = {
      item,
      pinned: true,
      selected: false,
      canPin: true,
      canEdit: true,
      canDelete: false
    }

    expect(registry.resolve(context, 'menu')).toMatchObject([
      { id: 'assistant.select', label: 'Select' },
      { id: 'assistant.pin', label: 'Unpin' },
      { id: 'assistant.edit', label: 'Edit' },
      {
        id: 'assistant.delete',
        label: 'Delete',
        danger: true,
        availability: { enabled: false }
      }
    ])

    await expect(registry.execute('assistant.pin', context)).resolves.toBe(true)
    expect(handlers.onTogglePin).toHaveBeenCalledWith(item)
  })

  it('renders AssistantListV2 with search, pinned groups, sort, virtualization, and menu callbacks', () => {
    const handlers = {
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn()
    }
    const assistants = [
      { id: 'assistant-a', name: 'Alpha assistant', pinned: false, updatedAt: 1 },
      { id: 'assistant-b', name: 'Beta pinned', pinned: true, updatedAt: 3 },
      { id: 'assistant-c', name: 'Gamma assistant', pinned: false, updatedAt: 2 }
    ]

    render(
      <AssistantListV2
        items={assistants}
        selectedId="assistant-a"
        handlers={handlers}
        labels={{
          searchPlaceholder: 'Search assistants',
          pinnedGroup: 'Pinned',
          assistantsGroup: 'Assistants',
          recentSort: 'Recent',
          nameSort: 'Name',
          select: 'Select',
          pin: 'Pin',
          unpin: 'Unpin',
          edit: 'Edit',
          delete: 'Delete'
        }}
      />
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('Assistants')).toBeInTheDocument()
    expect(screen.getByText('Beta pinned')).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ overscan: 6 }))

    fireEvent.click(screen.getByText('Gamma assistant'))
    expect(handlers.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'assistant-c' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Unpin' })[0])
    expect(handlers.onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ id: 'assistant-b' }))

    fireEvent.change(screen.getByPlaceholderText('Search assistants'), { target: { value: 'gamma' } })
    expect(screen.queryByText('Alpha assistant')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma assistant')).toBeInTheDocument()
  })
})
