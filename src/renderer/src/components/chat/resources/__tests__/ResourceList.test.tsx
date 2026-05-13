import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: ({ data, id }: { data?: unknown; id: string }) => {
      if (data) {
        dndMocks.sortableData.set(id, data)
      }

      return {
        attributes: { 'data-sortable-id': id },
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false
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

import { ResourceList, useResourceList } from '../ResourceList'
import type { ResourceListItemBase } from '../ResourceListContext'
import {
  AgentResourceList,
  AssistantList,
  AssistantResourceList,
  createAssistantListActionRegistry,
  HistoryResourceList,
  SessionResourceList,
  TopicResourceList
} from '../variants'

afterEach(() => {
  dndMocks.droppableData.clear()
  dndMocks.sortableData.clear()
  vi.useRealTimers()
})

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

function sortableData(id: string) {
  const data = dndMocks.sortableData.get(id)
  if (!data) {
    throw new Error(`Expected sortable data for ${id}`)
  }
  return { current: data }
}

function droppableData(id: string) {
  const data = dndMocks.droppableData.get(id)
  if (!data) {
    throw new Error(`Expected droppable data for ${id}`)
  }
  return { current: data }
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

  it('renders context menu actions from resource item composition', () => {
    const onRenameItem = vi.fn()
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
      <Provider items={ITEMS} onRenameItem={onRenameItem}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
    expect(screen.getByLabelText('Rename Alpha')).toBeInTheDocument()
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

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:beta'), id: 'item:beta' },
      over: { data: sortableData('item:alpha'), id: 'item:alpha' }
    })
    expect(onReorder).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'beta',
        overId: 'alpha',
        overType: 'item',
        position: 'before',
        sourceGroupId: 'all',
        targetGroupId: 'all',
        type: 'item'
      })
    )
  })

  it('maps grouped virtual item and group drops through resource reorder payloads', () => {
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        dragCapabilities={{ items: true, itemCrossGroup: true, itemSameGroup: true }}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        onReorder={onReorder}>
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

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:beta'), id: 'item:beta' },
      over: { data: sortableData('item:alpha'), id: 'item:alpha' }
    })
    expect(onReorder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        activeId: 'beta',
        overId: 'alpha',
        overType: 'item',
        sourceGroupId: 'session',
        sourceIndex: 1,
        targetGroupId: 'session',
        targetIndex: 0,
        type: 'item'
      })
    )

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: sortableData('item:gamma'), id: 'item:gamma' }
    })
    expect(onReorder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        activeId: 'alpha',
        overId: 'gamma',
        overType: 'item',
        sourceGroupId: 'session',
        sourceIndex: 0,
        targetGroupId: 'topic',
        targetIndex: 0,
        type: 'item'
      })
    )

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:beta'), id: 'item:beta' },
      over: { data: droppableData('group:topic'), id: 'group:topic' }
    })
    expect(onReorder).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        activeId: 'beta',
        overId: 'topic',
        overType: 'group',
        sourceGroupId: 'session',
        sourceIndex: 1,
        targetGroupId: 'topic',
        targetIndex: 0,
        type: 'item'
      })
    )
  })

  it('does not reorder grouped virtual items when the resource drop guard rejects the drop', () => {
    const canDropItem = vi.fn(() => false)
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        canDropItem={canDropItem}
        dragCapabilities={{ items: true, itemCrossGroup: true, itemSameGroup: true }}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        onReorder={onReorder}>
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

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: sortableData('item:gamma'), id: 'item:gamma' }
    })

    expect(canDropItem).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'alpha',
        overId: 'gamma',
        overType: 'item',
        sourceGroupId: 'session',
        targetGroupId: 'topic'
      })
    )
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('renders grouped virtual rows without visible group counts', () => {
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
    expect(screen.queryByText('2')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        count: ITEMS.length + 2
      })
    )
  })

  it('allows callers to replace the default group header icon', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderIcon={(group) => <span data-testid={`${group.id}-icon`}>#</span>}>
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

    expect(screen.getByTestId('session-icon')).toBeInTheDocument()
    expect(screen.getByTestId('topic-icon')).toBeInTheDocument()
  })

  it('auto-hides the shared list viewport scrollbar after scrolling stops', () => {
    vi.useFakeTimers()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS}>
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

    const viewport = screen.getByRole('listbox')
    expect(viewport).toHaveAttribute('data-scrolling', 'false')

    fireEvent.scroll(viewport)
    expect(viewport).toHaveAttribute('data-scrolling', 'true')

    act(() => {
      vi.advanceTimersByTime(1200)
    })

    expect(viewport).toHaveAttribute('data-scrolling', 'true')

    act(() => {
      vi.advanceTimersByTime(420)
    })

    expect(viewport).toHaveAttribute('data-scrolling', 'false')
  })

  it('limits each group to the default visible count and loads the next batch independently', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index + 1}`,
      name: `Item ${index + 1}`,
      kind: 'session' as const,
      updatedAt: index
    }))

    render(
      <Provider
        items={items}
        groupBy={() => ({ id: 'group', label: 'Group' })}
        groupShowMoreLabel="Show more"
        groupCollapseLabel="Collapse">
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

    expect(screen.getByText('Item 5')).toBeInTheDocument()
    expect(screen.queryByText('Item 6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 7 }))

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(screen.getByText('Item 10')).toBeInTheDocument()
    expect(screen.queryByText('Item 11')).not.toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 12 }))

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(screen.getByText('Item 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 14 }))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))

    expect(screen.getByText('Item 5')).toBeInTheDocument()
    expect(screen.queryByText('Item 6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('collapses grouped rows without showing group counts', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `topic-${index + 1}`,
      name: `Topic ${index + 1}`,
      kind: 'topic' as const,
      updatedAt: index
    }))

    render(
      <Provider items={items} groupBy={() => ({ id: 'topics', label: 'Topics' })} groupShowMoreLabel="Show more">
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

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }))

    expect(screen.queryByText('6')).not.toBeInTheDocument()
    expect(screen.queryByText('Topic 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 1 }))

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }))

    expect(screen.getByText('Topic 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('supports controlled collapsed group ids', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 2 }, (_, index) => ({
      id: `topic-${index + 1}`,
      name: `Topic ${index + 1}`,
      kind: 'topic' as const,
      updatedAt: index
    }))
    let collapsedGroupIds = ['topics']
    const onCollapsedGroupIdsChange = vi.fn((nextIds: string[]) => {
      collapsedGroupIds = nextIds
    })

    const view = render(
      <Provider
        items={items}
        groupBy={() => ({ id: 'topics', label: 'Topics' })}
        collapsedGroupIds={collapsedGroupIds}
        onCollapsedGroupIdsChange={onCollapsedGroupIdsChange}>
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

    expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Topic 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }))

    expect(onCollapsedGroupIdsChange).toHaveBeenCalledWith([])

    view.rerender(
      <Provider
        items={items}
        groupBy={() => ({ id: 'topics', label: 'Topics' })}
        collapsedGroupIds={collapsedGroupIds}
        onCollapsedGroupIdsChange={onCollapsedGroupIdsChange}>
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

    expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Topic 1')).toBeInTheDocument()
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

  it('does not reveal item actions just because a row is selected', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} selectedId="alpha">
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <ResourceList.ItemLeadingAction
                  aria-label={`Pin ${item.name}`}
                  data-active={item.pinned || undefined}
                />
                <ResourceList.ItemTitle>{item.name}</ResourceList.ItemTitle>
                <ResourceList.ItemAction aria-label={`Delete ${item.name}`} />
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Alpha').closest('[role="option"]')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('button', { name: 'Pin Alpha' })).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(screen.getByRole('button', { name: 'Pin Alpha' }).className).not.toContain(
      'group-data-[selected=true]:opacity-100'
    )
    expect(screen.getByRole('button', { name: 'Delete Alpha' })).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(screen.getByRole('button', { name: 'Delete Alpha' }).className).not.toContain(
      'group-data-[selected=true]:opacity-100'
    )
    expect(screen.getByRole('button', { name: 'Pin Beta' })).toHaveAttribute('data-active', 'true')
  })

  it('keeps sidebar header and search chrome visually quiet', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS}>
        <ResourceList.Frame>
          <ResourceList.Header title="Resources" count={ITEMS.length} actions={<ResourceList.HeaderActionButton />}>
            <ResourceList.Search placeholder="Search resources" />
          </ResourceList.Header>
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Resources')).toHaveClass('text-muted-foreground/60')
    expect(screen.getByText(String(ITEMS.length))).toHaveClass('text-muted-foreground/40')
    expect(screen.getByPlaceholderText('Search resources')).toHaveClass(
      'rounded-full',
      'h-7',
      'text-[10px]',
      'md:text-[10px]',
      'border-sidebar-border/40',
      'placeholder:text-[10px]',
      'placeholder:text-muted-foreground/45'
    )
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

  it('renders AssistantList with search, pinned groups, sort, virtualization, and menu callbacks', () => {
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
      <AssistantList
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
