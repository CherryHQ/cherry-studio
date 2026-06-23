import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const animationStyles = readFileSync(join(process.cwd(), 'src/renderer/assets/styles/animation.css'), 'utf8')

type VirtualizerOptionsMock = {
  count: number
  estimateSize: (index: number) => number
  overscan?: number
}

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: 40
      })),
    getTotalSize: () => options.count * 40,
    measureElement: vi.fn(),
    scrollElement: null,
    scrollToIndex: virtualMocks.scrollToIndex
  })),
  scrollToIndex: vi.fn()
}))

const dndMocks = vi.hoisted(() => ({
  droppableData: new Map<string, unknown>(),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragOver: undefined as undefined | ((event: any) => void),
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
    DndContext: ({
      children,
      onDragEnd,
      onDragOver,
      onDragStart
    }: {
      children: ReactNode
      onDragEnd?: any
      onDragOver?: any
      onDragStart?: any
    }) => {
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragOver = onDragOver
      dndMocks.onDragStart = onDragStart
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    DragOverlay: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
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
    verticalListSortingStrategy: vi.fn(() => null)
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined
    }
  }
}))

import type * as Commands from '@renderer/components/command'

vi.mock('@renderer/components/command', async (importActual) => ({
  ...(await importActual<typeof Commands>()),
  CommandHint: () => null
}))

import type { ResolvedAction } from '../../actions/actionTypes'
import { ResourceListActionContextMenu } from '../../actions/ResourceListActionContextMenu'
import {
  ResourceList,
  type ResourceListExpansionState,
  useResourceList,
  useResourceListActions,
  useResourceListGroupState,
  useResourceListRowState
} from '../ResourceList'
import type { ResourceListContextValue, ResourceListItemBase } from '../ResourceListContext'
import { SessionResourceList, TopicResourceList } from '../variants'

afterEach(() => {
  dndMocks.droppableData.clear()
  dndMocks.onDragEnd = undefined
  dndMocks.onDragOver = undefined
  dndMocks.onDragStart = undefined
  dndMocks.sortableData.clear()
  virtualMocks.scrollToIndex.mockClear()
  vi.useRealTimers()
})

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

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
        activeId: state.activeId,
        query: state.query,
        filters: state.filters,
        collapsedGroups: state.collapsedGroups,
        selectedId: state.selectedId,
        renamingId: state.renamingId,
        names: view.items.map((item) => item.name),
        visibleNames: view.visibleItems.map((item) => item.name),
        groups: view.groups.map((group) => group.group.id),
        sections: view.sections.map((section) => section.section.id)
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

function lastVirtualizerOptions() {
  const options = virtualMocks.useVirtualizer.mock.calls.at(-1)?.[0]
  if (!options) {
    throw new Error('Expected DynamicVirtualList to initialize a virtualizer')
  }
  return options
}

function droppableData(id: string) {
  const data = dndMocks.droppableData.get(id)
  if (!data) {
    throw new Error(`Expected droppable data for ${id}`)
  }
  return { current: data }
}

describe('ResourceList', () => {
  it('renders loading placeholders that match grouped list rhythm', () => {
    const { container } = render(<ResourceList.LoadingState />)

    const groups = container.querySelectorAll('[data-resource-list-loading-group]')
    const groupHeaders = container.querySelectorAll('[data-resource-list-loading-group-header]')
    const items = container.querySelectorAll('[data-resource-list-loading-item]')

    expect(groups).toHaveLength(2)
    expect(groupHeaders).toHaveLength(2)
    expect(items).toHaveLength(5)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(19)
    expect(groupHeaders[0]).toHaveClass('h-[38px]', 'px-1.5', 'pt-2', 'pb-1', 'gap-1.5')
    expect(groupHeaders[0].querySelector('[data-resource-list-leading-slot="true"]')).toHaveClass('size-6')
    expect(groupHeaders[0].querySelector('[data-slot="skeleton"]')).toHaveClass('size-5')
    expect(items[0]).toHaveClass('mb-1.5', 'h-8', 'rounded-lg', 'px-1.5', 'gap-1.5')
    expect(items[0].querySelector('[data-resource-list-leading-slot="true"]')).toHaveClass('size-6')
    expect(items[0].querySelector('[data-slot="skeleton"]')).toHaveClass('size-5')
    expect(items[0].querySelectorAll('[data-slot="skeleton"]')[2]).toHaveClass('size-5')
  })

  it('uses a border-only reveal focus animation without changing row background', () => {
    const revealFocusStart = animationStyles.indexOf('@keyframes animation-resource-list-reveal-focus')
    const revealFocusEnd = animationStyles.indexOf('/* 流光动画 */', revealFocusStart)
    const revealFocusStyle = animationStyles.slice(revealFocusStart, revealFocusEnd)

    expect(revealFocusStart).toBeGreaterThanOrEqual(0)
    expect(revealFocusEnd).toBeGreaterThan(revealFocusStart)
    expect(revealFocusStyle).toContain('.animation-resource-list-reveal-focus::after')
    expect(revealFocusStyle).toContain('box-shadow: inset')
    expect(revealFocusStyle).not.toMatch(/\bbackground(?:-color)?\s*:/)
  })

  it('renders a non-empty default error state', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} status="error">
        <ResourceList.Frame>
          <ResourceList.Body<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('error.boundary.default.message')
  })

  it('derives search, filter, sort, and group state without mutating items', () => {
    const originalOrder = ITEMS.map((item) => item.id).join(',')
    const Provider = ResourceList.Provider<TestItem>

    const { container } = render(
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
    expect(container.querySelector('[data-resource-list-item-row="true"]')).toHaveClass(
      'flex',
      'h-[38px]',
      'items-center',
      'w-full',
      'py-[2px]'
    )

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

  it('renders seeded empty groups without showing the empty state', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={[]}
        groupSeeds={[
          {
            id: 'assistant-empty',
            label: 'Empty Assistant'
          }
        ]}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}>
        <ResourceList.Frame>
          <Inspector />
          <ResourceList.Body<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByRole('button', { name: 'Empty Assistant' })).toBeInTheDocument()
    expect(screen.queryByText('No Resources')).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      names: [],
      visibleNames: [],
      groups: ['assistant-empty']
    })
  })

  it('keeps seeded groups before item-derived groups and toggles empty select-first groups', () => {
    const Provider = ResourceList.Provider<TestItem>
    const onGroupHeaderSelectItem = vi.fn()
    const onExpandedStateChange = vi.fn()

    render(
      <Provider
        items={[ITEMS[0]]}
        groupSeeds={[
          {
            id: 'empty-topic',
            label: 'Empty Topic'
          }
        ]}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        groupHeaderClickBehavior="select-first-then-toggle"
        expandedState={{ expandedSectionIds: [], expandedGroupIds: ['empty-topic', 'session'] }}
        onGroupHeaderSelectItem={onGroupHeaderSelectItem}
        onExpandedStateChange={onExpandedStateChange}>
        <ResourceList.Frame>
          <Inspector />
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

    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      groups: ['empty-topic', 'session']
    })

    fireEvent.click(screen.getByRole('button', { name: 'Empty Topic' }))

    expect(onGroupHeaderSelectItem).not.toHaveBeenCalled()
    expect(onExpandedStateChange).toHaveBeenCalledWith({
      expandedSectionIds: [],
      expandedGroupIds: ['session']
    })
  })

  it('lets callers handle empty select-first group clicks', () => {
    const Provider = ResourceList.Provider<TestItem>
    const onEmptyGroupHeaderClick = vi.fn()
    const onExpandedStateChange = vi.fn()

    render(
      <Provider
        items={[ITEMS[0]]}
        groupSeeds={[
          {
            id: 'empty-topic',
            label: 'Empty Topic'
          }
        ]}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        groupHeaderClickBehavior="select-first-then-toggle"
        expandedState={{ expandedSectionIds: [], expandedGroupIds: ['empty-topic', 'session'] }}
        onEmptyGroupHeaderClick={onEmptyGroupHeaderClick}
        onExpandedStateChange={onExpandedStateChange}>
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

    fireEvent.click(screen.getByRole('button', { name: 'Empty Topic' }))

    expect(onEmptyGroupHeaderClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'empty-topic', label: 'Empty Topic' })
    )
    expect(onExpandedStateChange).not.toHaveBeenCalled()
  })

  it('keeps resource actions stable when local filter state changes', () => {
    const actionRefs: unknown[] = []
    const Provider = ResourceList.Provider<TestItem>

    function ActionProbe() {
      const { actions } = useResourceList<TestItem>()
      actionRefs.push(actions)
      return (
        <button type="button" onClick={() => actions.toggleFilter('pinned')}>
          Toggle pinned
        </button>
      )
    }

    render(
      <Provider
        items={ITEMS}
        filterOptions={[
          {
            id: 'pinned',
            label: 'Pinned',
            predicate: (item) => item.pinned === true
          }
        ]}>
        <ResourceList.Frame>
          <ActionProbe />
          <Inspector />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Toggle pinned' }))

    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      filters: ['pinned']
    })
    expect(actionRefs.length).toBeGreaterThanOrEqual(2)
    expect(actionRefs.at(-1)).toBe(actionRefs[0])
  })

  it('updates only affected rows when selection changes locally', () => {
    const renderCounts = new Map<string, number>()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ context, item }: { context: ResourceListContextValue<TestItem>; item: TestItem }) {
      const rowState = useResourceListRowState(item.id)
      renderCounts.set(item.id, (renderCounts.get(item.id) ?? 0) + 1)

      return (
        <ResourceList.Item item={item}>
          <span data-testid={`${item.id}-state`}>{rowState.selected ? 'selected' : 'idle'}</span>
          <span data-testid={`${item.id}-context-selected`}>{context.state.selectedId ?? 'none'}</span>
        </ResourceList.Item>
      )
    }

    render(
      <Provider items={ITEMS}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem> renderItem={(item, context) => <Row context={context} item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 1,
      beta: 1,
      gamma: 1
    })

    fireEvent.click(screen.getByTestId('alpha-state').closest('[role="option"]') as HTMLElement)
    expect(screen.getByTestId('alpha-state')).toHaveTextContent('selected')
    expect(screen.getByTestId('alpha-context-selected')).toHaveTextContent('alpha')
    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 2,
      beta: 1,
      gamma: 1
    })

    fireEvent.click(screen.getByTestId('beta-state').closest('[role="option"]') as HTMLElement)
    expect(screen.getByTestId('alpha-state')).toHaveTextContent('idle')
    expect(screen.getByTestId('beta-state')).toHaveTextContent('selected')
    expect(screen.getByTestId('alpha-context-selected')).toHaveTextContent('beta')
    expect(screen.getByTestId('beta-context-selected')).toHaveTextContent('beta')
    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 3,
      beta: 2,
      gamma: 1
    })
  })

  it('uses caller item size estimates while keeping group chrome at the shared row height', () => {
    const estimateItemSize = vi.fn(() => 38)
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        estimateItemSize={estimateItemSize}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}>
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

    const options = lastVirtualizerOptions()

    expect(options.estimateSize(0)).toBe(38)
    expect(options.estimateSize(1)).toBe(38)
    expect(estimateItemSize).toHaveBeenCalledWith(0)
  })

  it('does not optimistically change row selection when selectedId is controlled', () => {
    const onSelectItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ item }: { item: TestItem }) {
      const rowState = useResourceListRowState(item.id)

      return (
        <ResourceList.Item item={item}>
          <span data-testid={`${item.id}-controlled-state`}>{rowState.selected ? 'selected' : 'idle'}</span>
        </ResourceList.Item>
      )
    }

    render(
      <Provider items={ITEMS} selectedId={null} onSelectItem={onSelectItem}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getByTestId('alpha-controlled-state').closest('[role="option"]') as HTMLElement)

    expect(onSelectItem).toHaveBeenCalledWith('alpha')
    expect(screen.getByTestId('alpha-controlled-state')).toHaveTextContent('idle')
    expect(screen.getByTestId('beta-controlled-state')).toHaveTextContent('idle')
  })

  it('moves listbox active descendant with keyboard before selecting on Enter', () => {
    const onSelectItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ item }: { item: TestItem }) {
      const rowState = useResourceListRowState(item.id)

      return (
        <ResourceList.Item item={item}>
          <span data-testid={`${item.id}-active`}>{rowState.active ? 'active' : 'idle'}</span>
          <span data-testid={`${item.id}-selected`}>{rowState.selected ? 'selected' : 'idle'}</span>
        </ResourceList.Item>
      )
    }

    render(
      <Provider items={ITEMS} selectedId="alpha" onSelectItem={onSelectItem}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveAttribute('tabindex', '0')
    expect(listbox).toHaveAttribute('aria-activedescendant', 'resource-list-option-alpha')
    expect(screen.getByTestId('alpha-active')).toHaveTextContent('active')
    expect(screen.getByTestId('alpha-selected')).toHaveTextContent('selected')

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })

    expect(onSelectItem).not.toHaveBeenCalled()
    expect(listbox).toHaveAttribute('aria-activedescendant', 'resource-list-option-beta')
    expect(screen.getByTestId('alpha-active')).toHaveTextContent('idle')
    expect(screen.getByTestId('beta-active')).toHaveTextContent('active')
    expect(screen.getByTestId('alpha-selected')).toHaveTextContent('selected')
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' })

    fireEvent.keyDown(listbox, { key: 'End' })

    expect(listbox).toHaveAttribute('aria-activedescendant', 'resource-list-option-gamma')
    expect(screen.getByTestId('gamma-active')).toHaveTextContent('active')

    fireEvent.keyDown(listbox, { key: 'Home' })

    expect(listbox).toHaveAttribute('aria-activedescendant', 'resource-list-option-alpha')
    expect(screen.getByTestId('alpha-active')).toHaveTextContent('active')

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })

    expect(onSelectItem).toHaveBeenCalledWith('beta')
  })

  it('updates only the renamed row when inline rename starts', () => {
    const renderCounts = new Map<string, number>()
    const Provider = ResourceList.Provider<TestItem>

    function RenameProbe() {
      const actions = useResourceListActions()
      return (
        <button type="button" onClick={() => actions.startRename('alpha')}>
          Rename alpha
        </button>
      )
    }

    function Row({ item }: { item: TestItem }) {
      const rowState = useResourceListRowState(item.id)
      renderCounts.set(item.id, (renderCounts.get(item.id) ?? 0) + 1)

      return (
        <ResourceList.Item item={item}>
          <ResourceList.RenameField item={item} aria-label={`Rename ${item.name}`} />
          {!rowState.renaming && <span>{item.name}</span>}
        </ResourceList.Item>
      )
    }

    render(
      <Provider items={ITEMS}>
        <ResourceList.Frame>
          <RenameProbe />
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rename alpha' }))

    expect(screen.getByLabelText('Rename Alpha')).toBeInTheDocument()
    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 2,
      beta: 1,
      gamma: 1
    })
  })

  it('updates only the revealed row when reveal focus appears and clears', async () => {
    vi.useFakeTimers()
    const renderCounts = new Map<string, number>()
    const Provider = ResourceList.Provider<TestItem>

    function RowProbe({ id }: { id: string }) {
      const rowState = useResourceListRowState(id)
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1)

      return <span data-testid={`${id}-reveal`}>{rowState.revealFocused ? 'focused' : 'idle'}</span>
    }

    function RevealHarness() {
      const [requestId, setRequestId] = useState<number | null>(null)
      const children = useMemo(
        () => (
          <>
            <button type="button" onClick={() => setRequestId(1)}>
              Reveal alpha
            </button>
            <RowProbe id="alpha" />
            <RowProbe id="beta" />
          </>
        ),
        []
      )

      return (
        <Provider items={ITEMS} revealRequest={requestId ? { itemId: 'alpha', requestId } : undefined}>
          {children}
        </Provider>
      )
    }

    render(<RevealHarness />)

    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 1,
      beta: 1
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reveal alpha' }))

    expect(screen.getByTestId('alpha-reveal')).toHaveTextContent('focused')
    expect(screen.getByTestId('beta-reveal')).toHaveTextContent('idle')
    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 2,
      beta: 1
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByTestId('alpha-reveal')).toHaveTextContent('idle')
    expect(Object.fromEntries(renderCounts)).toEqual({
      alpha: 3,
      beta: 1
    })
  })

  it('updates only affected group headers when selected item crosses groups', () => {
    const renderCounts = new Map<string, number>()
    const Provider = ResourceList.Provider<TestItem>

    function GroupProbe({ groupId }: { groupId: string }) {
      const groupState = useResourceListGroupState(groupId)
      renderCounts.set(groupId, (renderCounts.get(groupId) ?? 0) + 1)

      return <span data-testid={`${groupId}-selected`}>{groupState.selected ? 'selected' : 'idle'}</span>
    }

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderIcon={(group) => <GroupProbe groupId={group.id} />}>
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

    const initialSessionCount = renderCounts.get('session') ?? 0
    const initialTopicCount = renderCounts.get('topic') ?? 0

    fireEvent.click(screen.getByText('Alpha').closest('[role="option"]') as HTMLElement)
    expect(screen.getByTestId('session-selected')).toHaveTextContent('selected')
    expect(screen.getByTestId('topic-selected')).toHaveTextContent('idle')
    expect(Object.fromEntries(renderCounts)).toEqual({
      session: initialSessionCount + 1,
      topic: initialTopicCount
    })

    fireEvent.click(screen.getByText('Gamma').closest('[role="option"]') as HTMLElement)
    expect(screen.getByTestId('session-selected')).toHaveTextContent('idle')
    expect(screen.getByTestId('topic-selected')).toHaveTextContent('selected')
    expect(Object.fromEntries(renderCounts)).toEqual({
      session: initialSessionCount + 2,
      topic: initialTopicCount + 1
    })
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

  it('cancels inline rename with Escape without committing the draft name', () => {
    const onRenameItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    function Row({ item }: { item: TestItem }) {
      const { actions } = useResourceList<TestItem>()
      const rowState = useResourceListRowState(item.id)

      return (
        <ResourceList.Item item={item}>
          <ResourceList.RenameField item={item} aria-label={`Rename ${item.name}`} />
          {!rowState.renaming && <span>{item.name}</span>}
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
    fireEvent.change(input, { target: { value: 'Draft Alpha' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRenameItem).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Rename Alpha')).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      renamingId: null
    })
  })

  it('renders context menu actions from resource item composition', async () => {
    const onRenameItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>
    const menuActions: ResolvedAction[] = [
      {
        id: 'rename',
        label: 'Rename',
        danger: false,
        availability: { visible: true, enabled: true },
        children: []
      }
    ]

    function Row({ item }: { item: TestItem }) {
      const { actions } = useResourceList<TestItem>()
      return (
        <ResourceListActionContextMenu
          item={item}
          actions={menuActions}
          onAction={(action) => {
            if (action.id === 'rename') actions.startRename(item.id)
          }}>
          <ResourceList.Item item={item}>
            <ResourceList.RenameField item={item} aria-label={`Rename ${item.name}`} />
            <span>{item.name}</span>
            <button type="button" onClick={() => actions.startRename(item.id)}>
              Rename inline
            </button>
          </ResourceList.Item>
        </ResourceListActionContextMenu>
      )
    }

    render(
      <Provider items={ITEMS} onRenameItem={onRenameItem}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
        </ResourceList.Frame>
      </Provider>
    )

    fireEvent.contextMenu(screen.getByRole('option', { name: 'Alpha Rename inline' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
    await flushAnimationFrame()
    expect(screen.getByLabelText('Rename Alpha')).toBeInTheDocument()
  })

  it('defers resolved actions until the shared context menu is recreated', async () => {
    const onAction = vi.fn()
    let deferredAction: FrameRequestCallback | undefined
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      deferredAction = callback
      return 1
    })
    const Provider = ResourceList.Provider<TestItem>
    const actions: ResolvedAction[] = [
      {
        id: 'rename',
        label: 'Rename',
        danger: false,
        availability: { visible: true, enabled: true },
        children: []
      },
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        availability: { visible: true, enabled: true },
        children: []
      }
    ]

    function Row({ item }: { item: TestItem }) {
      return (
        <ResourceListActionContextMenu item={item} actions={actions} onAction={onAction}>
          <ResourceList.Item item={item}>
            <span>{item.name}</span>
          </ResourceList.Item>
        </ResourceListActionContextMenu>
      )
    }

    try {
      render(
        <Provider items={ITEMS}>
          <ResourceList.Frame>
            <ResourceList.VirtualItems<TestItem> renderItem={(item) => <Row item={item} />} />
          </ResourceList.Frame>
        </Provider>
      )

      fireEvent.contextMenu(screen.getByRole('option', { name: 'Alpha' }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
      expect(onAction).not.toHaveBeenCalled()

      await act(async () => {
        await Promise.resolve()
      })

      act(() => {
        deferredAction?.(0)
      })

      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'delete' }))
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
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

  it('keeps grouped virtual items stable during drag over and reorders only on drop', () => {
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        dragCapabilities={{ items: true, itemCrossGroup: true, itemSameGroup: true }}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        onReorder={onReorder}>
        <ResourceList.Frame>
          <Inspector />
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

    dndMocks.onDragOver?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: sortableData('item:gamma'), id: 'item:gamma' }
    })

    expect(onReorder).not.toHaveBeenCalled()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      names: ['Alpha', 'Beta', 'Gamma']
    })

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: sortableData('item:gamma'), id: 'item:gamma' }
    })

    expect(onReorder).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'alpha',
        overId: 'gamma',
        overType: 'item',
        sourceGroupId: 'session',
        targetGroupId: 'topic',
        type: 'item'
      })
    )
  })

  it('maps group drops with hidden items to the last visible item insertion point', () => {
    const onReorder = vi.fn()
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [
      { id: 'alpha', name: 'Alpha', kind: 'session', updatedAt: 1 },
      { id: 'gamma', name: 'Gamma', kind: 'topic', updatedAt: 2 },
      { id: 'delta', name: 'Delta', kind: 'topic', updatedAt: 3 }
    ]

    render(
      <Provider
        items={items}
        defaultGroupVisibleCount={1}
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

    dndMocks.onDragOver?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: droppableData('group:topic'), id: 'group:topic' }
    })
    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:alpha'), id: 'item:alpha' },
      over: { data: droppableData('group:topic'), id: 'group:topic' }
    })

    expect(onReorder).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'alpha',
        overId: 'gamma',
        overType: 'item',
        position: 'after',
        targetGroupId: 'topic',
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
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveClass('text-inherit')
    expect(screen.getByRole('button', { name: 'Pinned' })).not.toHaveClass('hover:text-muted-foreground/70')
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
        getGroupHeaderIcon={(group, { collapsed }) => (
          <span data-collapsed={collapsed} data-testid={`${group.id}-icon`}>
            #
          </span>
        )}>
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
    expect(screen.getByTestId('session-icon')).toHaveAttribute('data-collapsed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'session' }))
    expect(screen.getByTestId('session-icon')).toHaveAttribute('data-collapsed', 'true')
  })

  it('omits the group header icon slot when no icon is provided', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} groupBy={(item) => ({ id: item.kind, label: item.kind })} getGroupHeaderIcon={() => null}>
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

    expect(
      screen.getByRole('button', { name: 'session' }).querySelector('[data-resource-list-leading-slot="true"]')
    ).toBeNull()
  })

  it('renders a chevron that reflects the group header collapsed state', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} groupBy={(item) => ({ id: item.kind, label: item.kind })}>
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

    const sessionButton = screen.getByRole('button', { name: 'session' })
    const sessionLabel = sessionButton.querySelector('span')
    const sessionChevron = sessionButton.querySelector<SVGSVGElement>('svg')
    expect(sessionLabel).not.toBeNull()
    expect(sessionChevron).not.toBeNull()
    expect(sessionChevron!.previousElementSibling).toBe(sessionLabel)
    expect(sessionLabel!).not.toHaveClass('flex-1')
    expect(sessionChevron!).toHaveClass(
      'hidden',
      'group-hover/resource-list-group:block',
      'group-focus-within/resource-list-group:block',
      'group-has-data-[state=open]/resource-list-group:block'
    )
    expect(sessionChevron!.style.transform).toBe('rotate(90deg)')

    fireEvent.click(sessionButton)
    expect(sessionButton.querySelector<SVGSVGElement>('svg')!.style.transform).toBe('none')
  })

  it('hides item leading slots when the group header has no icon', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderIcon={(group) => (group.id === 'session' ? <span>#</span> : null)}>
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <ResourceList.ItemLeadingSlot data-testid={`${item.id}-leading-slot`}>
                  <span />
                </ResourceList.ItemLeadingSlot>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByTestId('alpha-leading-slot').closest('[data-resource-list-item-row="true"]')).toHaveAttribute(
      'data-resource-list-group-header-icon-visible',
      'true'
    )
    expect(screen.getByTestId('gamma-leading-slot').closest('[data-resource-list-item-row="true"]')).toHaveAttribute(
      'data-resource-list-group-header-icon-visible',
      'false'
    )
    expect(screen.getByTestId('gamma-leading-slot').closest('[data-resource-list-item-row="true"]')).toHaveClass(
      '[&_[data-resource-list-leading-slot=true]]:hidden',
      '[&_[role=option]]:!px-2.5'
    )
  })

  it('renders caller-provided leading group header actions separately from collapse controls', () => {
    const onSelectGroup = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderLeadingAction={(group) => (
          <button
            type="button"
            aria-label={`Select ${group.label}`}
            onClick={(event) => {
              event.stopPropagation()
              onSelectGroup(group.id)
            }}
          />
        )}>
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

    const sessionCollapseButton = screen.getByRole('button', { name: 'session' })
    expect(sessionCollapseButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Select session' }))

    expect(onSelectGroup).toHaveBeenCalledWith('session')
    expect(sessionCollapseButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(sessionCollapseButton)
    expect(sessionCollapseButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('can select the first item in a group before toggling the selected group header', () => {
    const onGroupHeaderSelectItem = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        groupHeaderClickBehavior="select-first-then-toggle"
        onGroupHeaderSelectItem={onGroupHeaderSelectItem}>
        <ResourceList.Frame>
          <Inspector />
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

    const sessionGroupButton = screen.getByRole('button', { name: 'session' })
    const sessionGroupHeader = sessionGroupButton.closest('[data-selected]')
    expect(sessionGroupButton).toHaveAttribute('aria-expanded', 'true')
    expect(sessionGroupHeader).toBeNull()

    fireEvent.click(sessionGroupButton)

    expect(onGroupHeaderSelectItem).toHaveBeenCalledWith('alpha')
    expect(sessionGroupButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha').closest('[role="option"]')).toHaveAttribute('aria-selected', 'true')
    expect(sessionGroupButton).toHaveAttribute('aria-current', 'true')
    expect(sessionGroupButton.closest('[data-selected]')).toHaveAttribute('data-selected', 'true')
    expect(sessionGroupButton.closest('[data-selected]')?.firstElementChild?.className).toContain('h-8')
    expect(screen.getByRole('button', { name: 'topic' })).not.toHaveAttribute('aria-current')
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      collapsedGroups: [],
      selectedId: 'alpha'
    })

    fireEvent.click(sessionGroupButton)

    expect(sessionGroupButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      collapsedGroups: ['session'],
      selectedId: 'alpha'
    })
  })

  it('selects the first item before expanding a collapsed controlled group header', () => {
    const onGroupHeaderSelectItem = vi.fn()
    const onExpandedStateChange = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        groupHeaderClickBehavior="select-first-then-toggle"
        expandedState={{ expandedSectionIds: [], expandedGroupIds: [] }}
        onExpandedStateChange={onExpandedStateChange}
        onGroupHeaderSelectItem={onGroupHeaderSelectItem}>
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

    const sessionGroupButton = screen.getByRole('button', { name: 'session' })
    expect(sessionGroupButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(sessionGroupButton)

    expect(onGroupHeaderSelectItem).toHaveBeenCalledWith('alpha')
    expect(onExpandedStateChange).not.toHaveBeenCalled()
    expect(sessionGroupButton).toHaveAttribute('aria-expanded', 'false')
    expect(sessionGroupButton).toHaveAttribute('aria-current', 'true')
  })

  it('keeps group header action buttons compact on the right side', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderAction={() => <ResourceList.GroupHeaderActionButton aria-label="Group more" />}>
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

    const groupActionButton = screen.getAllByRole('button', { name: 'Group more' })[0]
    const groupActionWrapper = groupActionButton.parentElement

    expect(groupActionButton).toHaveClass('size-6', 'min-h-6', 'min-w-6', 'rounded-md', 'p-0', '[&_svg]:size-3!')
    expect(groupActionButton).not.toHaveClass('min-h-7.5')
    expect(groupActionWrapper).toHaveClass(
      'hidden',
      'group-hover/resource-list-group:flex',
      'group-focus-within/resource-list-group:flex',
      'has-data-[state=open]:flex'
    )
  })

  it('opens group header context menus from the group header trigger', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderContextMenu={() => [
          { type: 'item', id: 'group-menu', label: 'Group Context Menu', onSelect: () => {} }
        ]}>
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'session' }))

    expect(screen.getByText('Group Context Menu')).toBeInTheDocument()
  })

  it('renders one context-menu trigger per group with a header context menu', () => {
    const Provider = ResourceList.Provider<TestItem>
    const { container } = render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderContextMenu={() => [
          { type: 'item', id: 'group-menu', label: 'Group Context Menu', onSelect: () => {} }
        ]}>
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

    // ITEMS contributes two groups (`session`, `topic`); each owns its own trigger.
    expect(container.querySelectorAll('[data-testid="context-menu-trigger"]')).toHaveLength(2)
  })

  it('does not bubble group header action context menus to the group header trigger', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderAction={() => <ResourceList.GroupHeaderActionButton aria-label="Group more" />}
        getGroupHeaderContextMenu={() => [
          { type: 'item', id: 'group-menu', label: 'Group Context Menu', onSelect: () => {} }
        ]}>
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

    fireEvent.contextMenu(screen.getAllByRole('button', { name: 'Group more' })[0])

    expect(screen.queryByText('Group Context Menu')).not.toBeInTheDocument()
  })

  it('routes group header context menu items to the right group', async () => {
    const onAction = vi.fn()
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider
        items={ITEMS}
        groupBy={(item) => ({ id: item.kind, label: item.kind })}
        getGroupHeaderContextMenu={(group) => [
          { type: 'item', id: 'run', label: `Run ${group.label}`, onSelect: () => onAction(group.id) }
        ]}>
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'session' }))
    expect(screen.getByRole('button', { name: 'Run session' })).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'topic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run topic' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('topic'))
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
    expect(viewport).toHaveClass('-mr-2', 'pr-2', '[scrollbar-gutter:stable]')
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

  it('limits each group to the default visible count and expands the group independently', () => {
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
        getGroupHeaderIcon={() => <span>#</span>}
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
    const showMoreButton = screen.getByRole('button', { name: 'Show more' })
    expect(showMoreButton.parentElement).toHaveClass('pl-9')
    expect(showMoreButton).toHaveClass('text-muted-foreground/55', 'hover:text-inherit')
    expect(showMoreButton).not.toHaveClass('opacity-[0.65]')
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 7 }))

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(screen.getByText('Item 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 14 }))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))

    expect(screen.getByText('Item 5')).toBeInTheDocument()
    expect(screen.queryByText('Item 6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('aligns group footer actions with header text when the group header has no icon', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `item-${index + 1}`,
      name: `Item ${index + 1}`,
      kind: 'session' as const,
      updatedAt: index
    }))

    render(
      <Provider
        items={items}
        groupBy={() => ({ id: 'group', label: 'Group' })}
        getGroupHeaderIcon={() => null}
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

    const showMoreButton = screen.getByRole('button', { name: 'Show more' })
    expect(showMoreButton.parentElement).toHaveClass('pl-2.5')
    expect(showMoreButton.parentElement).not.toHaveClass('pl-9')

    fireEvent.click(showMoreButton)

    const collapseButton = screen.getByRole('button', { name: 'Collapse' })
    expect(collapseButton.parentElement).toHaveClass('pl-2.5')
    expect(collapseButton.parentElement).not.toHaveClass('pl-9')
  })

  it('toggles every group in a section from a menu item without collapsing the section', () => {
    const Provider = ResourceList.Provider<TestItem & { groupId: string }>
    const items = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `alpha-${index + 1}`,
        name: `Alpha ${index + 1}`,
        kind: 'topic' as const,
        updatedAt: index,
        groupId: 'alpha'
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `beta-${index + 1}`,
        name: `Beta ${index + 1}`,
        kind: 'topic' as const,
        updatedAt: index,
        groupId: 'beta'
      }))
    ]

    render(
      <Provider
        items={items}
        groupBy={(item) => ({
          id: item.groupId,
          label: item.groupId === 'alpha' ? 'Alpha' : 'Beta'
        })}
        sectionBy={() => ({ id: 'assistants', label: 'Assistants' })}
        defaultGroupVisibleCount={5}
        groupShowMoreLabel="Show more"
        groupCollapseLabel="Collapse">
        <ResourceList.Frame>
          <ResourceList.Header
            actions={
              <ResourceList.SectionToggleMenuItem
                sectionId="assistants"
                expandLabel="Expand all"
                collapseLabel="Collapse all"
              />
            }
          />
          <ResourceList.VirtualItems<TestItem & { groupId: string }>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <span>{item.name}</span>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Alpha 1')).toBeInTheDocument()
    expect(screen.getByText('Beta 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))

    expect(screen.queryByRole('button', { name: 'Assistants' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))

    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha 1')).toBeInTheDocument()
    expect(screen.getByText('Beta 1')).toBeInTheDocument()
  })

  it('resets expanded display counts when collapsing a controlled section', () => {
    const Provider = ResourceList.Provider<TestItem & { groupId: string }>
    const items = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `alpha-${index + 1}`,
        name: `Alpha ${index + 1}`,
        kind: 'topic' as const,
        updatedAt: index,
        groupId: 'alpha'
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `beta-${index + 1}`,
        name: `Beta ${index + 1}`,
        kind: 'topic' as const,
        updatedAt: index,
        groupId: 'beta'
      }))
    ]

    function ControlledSectionHarness() {
      const [expandedState, setExpandedState] = useState<ResourceListExpansionState>({
        expandedSectionIds: ['assistants'],
        expandedGroupIds: ['alpha', 'beta']
      })

      return (
        <Provider
          items={items}
          expandedState={expandedState}
          onExpandedStateChange={setExpandedState}
          groupBy={(item) => ({
            id: item.groupId,
            label: item.groupId === 'alpha' ? 'Alpha' : 'Beta'
          })}
          groupSeeds={[{ id: 'empty', label: 'Empty', section: { id: 'other', label: 'Other' } }]}
          sectionBy={() => ({ id: 'assistants', label: 'Assistants' })}
          getSectionHeaderAction={(section) => (
            <ResourceList.SectionCollapseActionButton alwaysVisible sectionId={section.id} label="Collapse display" />
          )}
          defaultGroupVisibleCount={5}
          groupShowMoreLabel="Show more"
          groupCollapseLabel="Collapse">
          <ResourceList.Frame>
            <ResourceList.VirtualItems<TestItem & { groupId: string }>
              renderItem={(item) => (
                <ResourceList.Item item={item}>
                  <span>{item.name}</span>
                </ResourceList.Item>
              )}
            />
          </ResourceList.Frame>
        </Provider>
      )
    }

    render(<ControlledSectionHarness />)

    expect(screen.queryByText('Alpha 6')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Show more' })[0])

    expect(screen.getByText('Alpha 6')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()

    const sectionHeader = screen.getByRole('button', { name: 'Assistants' }).closest('div')
    expect(sectionHeader).not.toBeNull()

    fireEvent.click(within(sectionHeader as HTMLElement).getByRole('button', { name: 'Collapse display' }))

    expect(screen.getByRole('button', { name: 'Assistants' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))

    expect(screen.getByText('Alpha 1')).toBeInTheDocument()
    expect(screen.queryByText('Alpha 6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument()
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

  it('supports controlled expanded group ids', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [
      { id: 'topic-1', name: 'Topic 1', kind: 'topic', updatedAt: 1 },
      { id: 'session-1', name: 'Session 1', kind: 'session', updatedAt: 2 }
    ]
    let expandedState: ResourceListExpansionState = { expandedSectionIds: [], expandedGroupIds: [] }
    const onExpandedStateChange = vi.fn((nextState: ResourceListExpansionState) => {
      expandedState = nextState
    })

    const view = render(
      <Provider
        items={items}
        groupBy={(item) => ({ id: item.kind, label: item.kind === 'topic' ? 'Topics' : 'Sessions' })}
        expandedState={expandedState}
        onExpandedStateChange={onExpandedStateChange}>
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

    expect(onExpandedStateChange).toHaveBeenCalledWith({
      expandedSectionIds: [],
      expandedGroupIds: ['topic']
    })

    view.rerender(
      <Provider
        items={items}
        groupBy={(item) => ({ id: item.kind, label: item.kind === 'topic' ? 'Topics' : 'Sessions' })}
        expandedState={expandedState}
        onExpandedStateChange={onExpandedStateChange}>
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

  it('keeps controlled section collapse when a child group is toggled before parent rerender', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [
      { id: 'pinned-topic', name: 'Pinned topic', kind: 'topic', pinned: true, updatedAt: 1 },
      { id: 'assistant-topic', name: 'Assistant topic', kind: 'topic', updatedAt: 2 }
    ]
    const onExpandedStateChange = vi.fn()

    render(
      <Provider
        items={items}
        expandedState={{
          expandedSectionIds: ['section:pinned', 'section:assistants'],
          expandedGroupIds: ['assistant-a']
        }}
        groupBy={(item) => (item.pinned ? { id: 'pinned', label: '' } : { id: 'assistant-a', label: 'Assistant A' })}
        onExpandedStateChange={onExpandedStateChange}
        sectionBy={(item) =>
          item.pinned ? { id: 'section:pinned', label: 'Pinned' } : { id: 'section:assistants', label: 'Assistants' }
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

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    expect(onExpandedStateChange).toHaveBeenLastCalledWith({
      expandedSectionIds: ['section:assistants'],
      expandedGroupIds: ['assistant-a']
    })

    fireEvent.click(screen.getByRole('button', { name: 'Assistant A' }))
    expect(onExpandedStateChange).toHaveBeenLastCalledWith({
      expandedSectionIds: ['section:assistants'],
      expandedGroupIds: []
    })
  })

  it('defaults the only controlled group to expanded after the group structure changes', async () => {
    const Provider = ResourceList.Provider<TestItem>

    function Harness() {
      const [items, setItems] = useState<TestItem[]>([
        { id: 'topic-1', name: 'Topic 1', kind: 'topic', updatedAt: 1 },
        { id: 'session-1', name: 'Session 1', kind: 'session', updatedAt: 2 }
      ])
      const [expandedState, setExpandedState] = useState<ResourceListExpansionState>({
        expandedSectionIds: [],
        expandedGroupIds: []
      })

      return (
        <Provider
          items={items}
          groupBy={(item) => ({ id: item.kind, label: item.kind === 'topic' ? 'Topics' : 'Sessions' })}
          expandedState={expandedState}
          onExpandedStateChange={setExpandedState}>
          <button
            type="button"
            onClick={() => setItems([{ id: 'topic-1', name: 'Topic 1', kind: 'topic', updatedAt: 1 }])}>
            Switch groups
          </button>
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
    }

    render(<Harness />)

    expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Switch groups' }))

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'true')
    )
    expect(screen.getByText('Topic 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Topics' }))

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'false')
    )
  })

  it('renders optional section headers above groups and expands both section and group for reveal requests', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [
      { id: 'alpha', name: 'Alpha', kind: 'session', pinned: true, updatedAt: 1 },
      { id: 'beta', name: 'Beta', kind: 'session', updatedAt: 2 },
      { id: 'gamma', name: 'Gamma', kind: 'topic', updatedAt: 3 }
    ]

    function SectionHarness({ requestId }: { requestId?: number }) {
      const [expandedState, setExpandedState] = useState<ResourceListExpansionState>({
        expandedSectionIds: ['section:pinned'],
        expandedGroupIds: []
      })

      return (
        <Provider
          items={items}
          expandedState={expandedState}
          groupBy={(item) => (item.pinned ? { id: 'pinned', label: '' } : { id: item.kind, label: item.kind })}
          onExpandedStateChange={setExpandedState}
          revealRequest={requestId ? { itemId: 'gamma', requestId } : undefined}
          sectionBy={(item) =>
            item.pinned ? { id: 'section:pinned', label: 'Pinned' } : { id: 'section:assistants', label: 'Assistants' }
          }>
          <ResourceList.Frame>
            <Inspector />
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
    }

    const view = render(<SectionHarness />)

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Assistants' })).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByRole('button', { name: 'Pinned' }).closest('[class*="group/resource-list-section"]')
    ).not.toHaveClass('pl-4')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(
      screen.getByText('Alpha').closest('[data-resource-list-item-row="true"]')?.firstElementChild
    ).not.toHaveClass('pl-4')
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.queryByText('gamma')).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      collapsedGroups: expect.arrayContaining(['section:assistants']),
      sections: ['section:pinned', 'section:assistants']
    })

    view.rerender(<SectionHarness requestId={1} />)

    expect(screen.getByRole('button', { name: 'Assistants' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'topic' })).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'topic' }).closest('[class*="group/resource-list-group"]')
    ).not.toHaveClass('pl-4')
    expect(
      screen.getByText('Gamma').closest('[data-resource-list-item-row="true"]')?.firstElementChild
    ).not.toHaveClass('pl-4')
    expect(screen.getByText('Gamma').closest('[role="option"]')).toHaveAttribute('data-reveal-focus', 'true')
    const revealedInspector = JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')
    expect(revealedInspector).toMatchObject({
      sections: ['section:pinned', 'section:assistants'],
      visibleNames: expect.arrayContaining(['Gamma'])
    })
    expect(revealedInspector.collapsedGroups).toEqual(expect.arrayContaining(['session']))
    expect(revealedInspector.collapsedGroups).not.toContain('section:assistants')
    expect(revealedInspector.collapsedGroups).not.toContain('topic')
  })

  it('hides single section headers while keeping section groups visible', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [{ id: 'alpha', name: 'Alpha', kind: 'session', pinned: false, updatedAt: 1 }]

    render(
      <Provider
        items={items}
        expandedState={{ expandedSectionIds: [], expandedGroupIds: ['session'] }}
        groupBy={(item) => ({ id: item.kind, label: 'Sessions' })}
        sectionBy={() => ({ id: 'section:agents', label: 'Agents' })}>
        <ResourceList.Frame>
          <Inspector />
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

    expect(screen.queryByRole('button', { name: 'Agents' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(virtualMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }))
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      sections: ['section:agents'],
      visibleNames: ['Alpha']
    })
  })

  it('keeps sibling sections collapsed when the last expanded controlled section is collapsed', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items: TestItem[] = [
      { id: 'alpha', name: 'Pinned topic', kind: 'topic', pinned: true, updatedAt: 1 },
      { id: 'beta', name: 'Assistant topic', kind: 'topic', updatedAt: 2 }
    ]

    function SectionHarness() {
      const [expandedState, setExpandedState] = useState<ResourceListExpansionState>({
        expandedSectionIds: ['section:assistants'],
        expandedGroupIds: []
      })

      return (
        <Provider
          items={items}
          expandedState={expandedState}
          groupBy={(item) => ({ id: item.pinned ? 'pinned' : 'assistant', label: '' })}
          onExpandedStateChange={setExpandedState}
          sectionBy={(item) =>
            item.pinned ? { id: 'section:pinned', label: 'Pinned' } : { id: 'section:assistants', label: 'Assistants' }
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
    }

    render(<SectionHarness />)

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Assistants' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Pinned topic')).not.toBeInTheDocument()
    expect(screen.getByText('Assistant topic')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assistants' }))

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Assistants' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Pinned topic')).not.toBeInTheDocument()
    expect(screen.queryByText('Assistant topic')).not.toBeInTheDocument()
  })

  it('reveals a requested item by clearing local filters, expanding its group, loading enough rows, and scrolling', async () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `topic-${index + 1}`,
      name: `Topic ${index + 1}`,
      kind: 'topic' as const,
      pinned: index === 0,
      updatedAt: index
    }))

    function RevealHarness({ requestId }: { requestId?: number }) {
      const [expandedState, setExpandedState] = useState<ResourceListExpansionState>({
        expandedSectionIds: [],
        expandedGroupIds: []
      })

      return (
        <Provider
          items={items}
          expandedState={expandedState}
          defaultGroupVisibleCount={5}
          filterOptions={[
            {
              id: 'pinned',
              label: 'Pinned',
              predicate: (item) => item.pinned === true
            }
          ]}
          groupBy={() => ({ id: 'topics', label: 'Topics' })}
          groupShowMoreLabel="Show more"
          onExpandedStateChange={setExpandedState}
          revealRequest={
            requestId ? { itemId: 'topic-6', requestId, clearFilters: true, clearQuery: true } : undefined
          }>
          <ResourceList.Frame>
            <ResourceList.Search placeholder="Search resources" />
            <ResourceList.FilterBar />
            <Inspector />
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
    }

    const view = render(<RevealHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'missing' } })

    expect(screen.getByPlaceholderText('Search resources')).toHaveValue('missing')
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      collapsedGroups: []
    })
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    vi.useFakeTimers()
    view.rerender(<RevealHarness requestId={1} />)
    await act(async () => {})

    expect(screen.getByText('Topic 6')).toBeInTheDocument()
    const revealedRow = screen.getByText('Topic 6').closest('[role="option"]')
    expect(revealedRow).not.toBeNull()
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', 'resource-list-option-topic-6')
    expect(revealedRow!).toHaveAttribute('data-active-descendant', 'true')
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')
    expect(revealedRow!).toHaveClass('animation-resource-list-reveal-focus')
    expect(screen.getByPlaceholderText('Search resources')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-expanded', 'true')
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      collapsedGroups: [],
      filters: [],
      visibleNames: expect.arrayContaining(['Topic 6'])
    })
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(revealedRow!).not.toHaveAttribute('data-reveal-focus')
  })

  it('does not shrink the default group window when the revealed item is already visible', () => {
    const Provider = ResourceList.Provider<TestItem>
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `topic-${index + 1}`,
      name: `Topic ${index + 1}`,
      kind: 'topic' as const,
      updatedAt: index
    }))

    function RevealHarness({ requestId }: { requestId?: number }) {
      return (
        <Provider
          items={items}
          defaultGroupVisibleCount={5}
          groupBy={() => ({ id: 'topics', label: 'Topics' })}
          groupShowMoreLabel="Show more"
          revealRequest={requestId ? { itemId: 'topic-4', requestId } : undefined}>
          <ResourceList.Frame>
            <Inspector />
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
    }

    const view = render(<RevealHarness />)

    expect(screen.getByText('Topic 4')).toBeInTheDocument()
    expect(screen.getByText('Topic 5')).toBeInTheDocument()
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    vi.useFakeTimers()
    view.rerender(<RevealHarness requestId={1} />)

    expect(screen.getByText('Topic 4').closest('[role="option"]')).toHaveAttribute('data-reveal-focus', 'true')
    expect(JSON.parse(screen.getByTestId('inspector').textContent ?? '{}')).toMatchObject({
      visibleNames: ['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5']
    })
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })
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
            <ResourceList.HeaderItem aria-label="Create" icon={<span />} label="Create" />
          </ResourceList.Header>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <ResourceList.ItemLeadingSlot data-testid={`${item.id}-leading-slot`}>
                  {item.id === 'alpha' ? <span data-testid="alpha-leading-icon" /> : null}
                </ResourceList.ItemLeadingSlot>
                <ResourceList.ItemTitle>{item.name}</ResourceList.ItemTitle>
                <ResourceList.ItemActions>
                  <ResourceList.ItemAction aria-label={`Action ${item.name}`} />
                </ResourceList.ItemActions>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Resources')).toBeInTheDocument()
    expect(screen.getByText(String(ITEMS.length))).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search resources')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveClass(
      'text-foreground/70!',
      'hover:text-foreground!',
      'data-[state=open]:text-foreground!',
      '[&_.lucide:not(.lucide-custom)]:text-current!',
      // 16px icon to match the new-topic SquarePen, not icon-navbar's default 18px.
      '[&_svg]:size-4!'
    )
    expect(screen.getByRole('button', { name: 'Create' })).toHaveClass('px-1.5')
    expect(screen.getByRole('listbox')).not.toHaveClass('px-1.5')
    expect(screen.getByRole('listbox').closest('[data-resource-list-variant]')).toHaveClass('p-1.5')
    expect(screen.getByText('Alpha').closest('[role="option"]')).toHaveClass(
      'relative',
      'gap-1.5',
      'px-2.5',
      'has-[[data-resource-list-leading-slot=true]]:px-1.5'
    )
    expect(screen.getByTestId('alpha-leading-slot')).toHaveClass('size-6')
    expect(screen.getByTestId('alpha-leading-icon')).toBeInTheDocument()
    expect(screen.getByTestId('beta-leading-slot')).toHaveClass('size-6')
    expect(screen.getByTestId('beta-leading-slot')).toHaveAttribute('aria-hidden', 'true')
    const action = screen.getByRole('button', { name: 'Action Alpha' })
    expect(action).toHaveClass('pointer-events-none', 'size-5')
    expect(action.closest('[data-resource-list-item-actions="true"]')).toHaveClass(
      'absolute',
      'right-1.5',
      'opacity-0',
      'group-hover:opacity-100'
    )
  })

  it('keeps a command HeaderItem shrinkable so its actions stay visible', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS}>
        <ResourceList.Frame>
          <ResourceList.Header>
            <ResourceList.HeaderItem
              command="topic.create"
              aria-label="Create"
              icon={<span />}
              label="Create"
              actions={<button type="button" aria-label="Filter" />}
            />
          </ResourceList.Header>
        </ResourceList.Frame>
      </Provider>
    )

    // Button's base class is `shrink-0`; the command branch (w-full) must re-add `shrink`
    // so the full-width button yields space to the actions slot instead of clipping it.
    const createButton = screen.getByRole('button', { name: 'Create' })
    expect(createButton).toHaveClass('w-full', 'shrink')
    expect(createButton).not.toHaveClass('flex-1')
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })

  it('does not reveal item actions just because a row is selected', () => {
    const Provider = ResourceList.Provider<TestItem>

    render(
      <Provider items={ITEMS} selectedId="alpha">
        <ResourceList.Frame>
          <ResourceList.VirtualItems<TestItem>
            renderItem={(item) => (
              <ResourceList.Item item={item}>
                <ResourceList.ItemTitle>{item.name}</ResourceList.ItemTitle>
                <ResourceList.ItemActions>
                  <ResourceList.ItemAction aria-label={`Delete ${item.name}`} />
                </ResourceList.ItemActions>
              </ResourceList.Item>
            )}
          />
        </ResourceList.Frame>
      </Provider>
    )

    expect(screen.getByText('Alpha').closest('[role="option"]')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByText('Alpha')).toHaveClass('font-normal', 'group-data-[selected=true]:font-medium')
    expect(screen.getByText('Beta')).toHaveClass('font-normal')
    expect(screen.getByRole('button', { name: 'Delete Alpha' })).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(screen.getByRole('button', { name: 'Delete Alpha' }).className).not.toContain(
      'group-data-[selected=true]:opacity-100'
    )
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
      'border-sidebar-border',
      'placeholder:text-[10px]',
      'placeholder:text-foreground-muted'
    )
  })

  it('exposes explicit business variants without a shared mode prop', () => {
    const variants = [
      ['session', SessionResourceList],
      ['topic', TopicResourceList]
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
