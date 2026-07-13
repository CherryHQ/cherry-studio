import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { ResourceEntityRail, type ResourceEntityRailItem } from '../ResourceEntityRail'

const feedbackMocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: feedbackMocks.loggerError })
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: feedbackMocks.toastError }
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/command', () => {
  return {
    CommandContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
    CommandPopupMenu: ({ children, extraItems }: { children: ReactNode; extraItems?: readonly any[] }) => (
      <div>
        {children}
        {extraItems?.map((item) => {
          if (item.type !== 'item') return null
          return (
            <button key={item.id} type="button" disabled={item.enabled === false} onClick={item.onSelect}>
              {item.label}
            </button>
          )
        })}
      </div>
    ),
    CommandMenuItems: () => null
  }
})

vi.mock('@renderer/components/VirtualList', () => {
  type Group<TGroup, TItem, THeader = TGroup, TFooter = unknown> = {
    group: TGroup
    header?: THeader
    items: readonly TItem[]
    footer?: TFooter
  }

  function buildGroupedVirtualRows<TGroup, TItem, THeader, TFooter>(
    groups: readonly Group<TGroup, TItem, THeader, TFooter>[],
    hasGroupHeader: boolean,
    hasGroupFooter: boolean
  ) {
    const rows: any[] = []
    let itemIndex = 0

    groups.forEach((entry, groupIndex) => {
      if (hasGroupHeader && entry.header !== undefined) {
        rows.push({ type: 'group-header', group: entry.group, groupIndex, header: entry.header })
      }

      entry.items.forEach((item, itemIndexInGroup) => {
        rows.push({ type: 'item', group: entry.group, groupIndex, item, itemIndex, itemIndexInGroup })
        itemIndex += 1
      })

      if (hasGroupFooter && entry.footer !== undefined) {
        rows.push({ type: 'group-footer', group: entry.group, groupIndex, footer: entry.footer })
      }
    })

    return rows
  }

  const GroupedVirtualListContent = ({
    dragEnabled,
    ref,
    className,
    groups,
    renderGroupFooter,
    renderGroupHeader,
    renderItem,
    role,
    scrollerProps,
    scrollElementRef,
    dragCapabilities
  }) => {
    const rows = buildGroupedVirtualRows(groups, Boolean(renderGroupHeader), Boolean(renderGroupFooter))

    return (
      <div
        ref={(node) => {
          // The real virtual list exposes an imperative scrollToIndex; stub it so keyboard
          // navigation (which scrolls the active item into view) works under this mock.
          const listNode = node as (HTMLDivElement & { scrollToIndex?: (index: number) => void }) | null
          if (listNode && typeof listNode.scrollToIndex !== 'function') listNode.scrollToIndex = () => {}
          if (typeof ref === 'function') ref(node)
          else if (ref) (ref as { current: HTMLDivElement | null }).current = node
          if (typeof scrollElementRef === 'function') scrollElementRef(node)
          else if (scrollElementRef) {
            const scrollRef = scrollElementRef as { current: HTMLDivElement | null }
            scrollRef.current = node
          }
        }}
        role={role}
        className={className}
        data-draggable={dragEnabled ? 'true' : 'false'}
        data-drag-capabilities={JSON.stringify(dragCapabilities ?? null)}
        {...scrollerProps}>
        {rows.map((row, index) => {
          if (row.type === 'group-header') {
            return <div key={index}>{renderGroupHeader(row.header, row.group, row.groupIndex)}</div>
          }

          if (row.type === 'group-footer') {
            return <div key={index}>{renderGroupFooter(row.footer, row.group, row.groupIndex)}</div>
          }

          return (
            <div key={index}>
              {renderItem(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)}
            </div>
          )
        })}
      </div>
    )
  }

  return {
    buildGroupedVirtualRows,
    DynamicVirtualList: () => null,
    GroupedSortableVirtualList: (props) => <GroupedVirtualListContent {...props} dragEnabled />,
    GroupedVirtualList: (props) => <GroupedVirtualListContent {...props} dragEnabled={false} />
  }
})

type TestEntity = ResourceEntityRailItem & {
  icon: ReactNode
}

const ITEMS: TestEntity[] = [
  { id: 'assistant-a', name: 'Assistant A', icon: <span data-testid="assistant-a-icon" /> },
  { id: 'assistant-b', name: 'Assistant B', icon: <span data-testid="assistant-b-icon" /> }
]

const EDIT_ACTION: ResolvedAction<unknown> = {
  id: 'edit',
  label: 'Edit',
  danger: false,
  availability: { visible: true, enabled: true },
  children: []
}

describe('ResourceEntityRail', () => {
  it('renders a history button next to add that fires onOpenHistoryRecords', () => {
    const onOpenHistoryRecords = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        variant="assistant"
        onAdd={vi.fn()}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'history.records.shortTitle' }))
    expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1)
  })

  it('marks the history button as current while history records are active', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        historyRecordsActive
        items={ITEMS}
        variant="assistant"
        onAdd={vi.fn()}
        onOpenHistoryRecords={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'history.records.shortTitle' })).toHaveAttribute('aria-current', 'page')
  })

  it('omits the history button when onOpenHistoryRecords is not provided', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'history.records.shortTitle' })).not.toBeInTheDocument()
  })

  it('renders active resource menu items without also selecting entity rows', () => {
    const onSelectResourceView = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        selectedId="assistant-a"
        resourceMenuItems={[
          {
            active: true,
            id: 'assistant-view',
            label: 'Assistants',
            onSelect: onSelectResourceView
          }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    const item = screen.getByRole('button', { name: 'Assistants' })

    expect(item).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Assistant A').closest('[role="option"]')).not.toHaveAttribute('data-selected', 'true')
    fireEvent.click(item)
    expect(onSelectResourceView).toHaveBeenCalledTimes(1)
  })

  it('marks the selected entity and wires context-menu actions', () => {
    const onContextMenuAction = vi.fn()
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        getContextMenuActions={() => [EDIT_ACTION]}
        items={ITEMS}
        selectedId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onContextMenuAction={onContextMenuAction}
        onSelect={vi.fn()}
      />
    )

    // Behavior, not styling: the selected entity is marked selected and others are not.
    expect(screen.getByText('Assistant A').closest('[role="option"]')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByText('Assistant B').closest('[role="option"]')).not.toHaveAttribute('data-selected', 'true')

    // Behavior: context-menu actions are dispatched with the row's entity.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onContextMenuAction).toHaveBeenCalledWith(ITEMS[0], EDIT_ACTION)

    requestAnimationFrameSpy.mockRestore()
  })

  it('renders row trailing actions next to the more menu without selecting the entity', () => {
    const onContextMenuAction = vi.fn()
    const onSelect = vi.fn()
    const onTrailingAction = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        getContextMenuActions={() => [EDIT_ACTION]}
        items={[
          {
            ...ITEMS[0],
            trailingAction: (
              <button type="button" aria-label="Create" onClick={onTrailingAction}>
                Create
              </button>
            )
          },
          ITEMS[1]
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onContextMenuAction={onContextMenuAction}
        onSelect={onSelect}
      />
    )

    const createButton = screen.getByRole('button', { name: 'Create' })
    const moreButton = screen.getAllByRole('button', { name: 'common.more' })[0]

    expect(createButton).toBeInTheDocument()
    expect(moreButton).toBeInTheDocument()
    expect(moreButton.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(createButton)

    expect(onTrailingAction).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onContextMenuAction).not.toHaveBeenCalled()
  })

  it('toggles the selected entity instead of selecting it again', () => {
    const onSelect = vi.fn()
    const onSelectedClick = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        selectedId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={onSelect}
        onSelectedClick={onSelectedClick}
      />
    )

    fireEvent.click(screen.getByText('Assistant A').closest('[role="option"]') as HTMLElement)
    expect(onSelectedClick).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Assistant B').closest('[role="option"]') as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
    expect(onSelectedClick).toHaveBeenCalledTimes(1)
  })

  it('reports rejected entity selection without leaving an unhandled promise', async () => {
    feedbackMocks.loggerError.mockClear()
    feedbackMocks.toastError.mockClear()
    const error = new Error('selection failed')

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn().mockRejectedValue(error)}
      />
    )

    fireEvent.click(screen.getByText('Assistant A').closest('[role="option"]') as HTMLElement)

    await waitFor(() => expect(feedbackMocks.toastError).toHaveBeenCalledWith('common.error'))
    expect(feedbackMocks.loggerError).toHaveBeenCalledWith('Failed to select resource entity rail item', {
      error,
      itemId: 'assistant-a',
      variant: 'assistant'
    })
  })

  it('activates entities from the keyboard, toggling the already-selected one', () => {
    const onSelect = vi.fn()
    const onSelectedClick = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        selectedId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={onSelect}
        onSelectedClick={onSelectedClick}
      />
    )

    const listbox = screen.getByRole('listbox', { name: 'Assistants' })

    // Enter on the already-selected entity toggles its pane instead of reselecting.
    fireEvent.keyDown(listbox, { key: 'Home' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onSelectedClick).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelect).not.toHaveBeenCalled()

    // Space on a different entity selects it, mirroring a mouse click.
    fireEvent.keyDown(listbox, { key: 'End' })
    fireEvent.keyDown(listbox, { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
    expect(onSelectedClick).toHaveBeenCalledTimes(1)
  })

  it('uses the selected click id for repeat-click toggles when the visual selection is cleared', () => {
    const onSelect = vi.fn()
    const onSelectedClick = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        selectedId={null}
        selectedClickId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={onSelect}
        onSelectedClick={onSelectedClick}
      />
    )

    fireEvent.click(screen.getByText('Assistant A').closest('[role="option"]') as HTMLElement)

    expect(onSelectedClick).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps repeat-click toggles available while history records clear the visual selection', () => {
    const onSelect = vi.fn()
    const onSelectedClick = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        historyRecordsActive
        items={ITEMS}
        selectedId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={onSelect}
        onSelectedClick={onSelectedClick}
      />
    )

    const row = screen.getByText('Assistant A').closest('[role="option"]') as HTMLElement
    expect(row).not.toHaveAttribute('data-selected', 'true')

    fireEvent.click(row)

    expect(onSelectedClick).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects the entity instead of toggling it while a resource menu item is active', () => {
    const onSelect = vi.fn()
    const onSelectedClick = vi.fn()

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        items={ITEMS}
        selectedId="assistant-a"
        resourceMenuItems={[
          {
            active: true,
            id: 'assistant-view',
            label: 'Assistants',
            onSelect: vi.fn()
          }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={onSelect}
        onSelectedClick={onSelectedClick}
      />
    )

    fireEvent.click(screen.getByText('Assistant A').closest('[role="option"]') as HTMLElement)

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelectedClick).not.toHaveBeenCalled()
  })

  it('does not select the entity when a context-menu action is picked', () => {
    const onSelect = vi.fn()
    const onContextMenuAction = vi.fn()
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })

    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants"
        getContextMenuActions={() => [EDIT_ACTION]}
        items={ITEMS}
        variant="assistant"
        onAdd={vi.fn()}
        onContextMenuAction={onContextMenuAction}
        onSelect={onSelect}
      />
    )

    // The "more" menu portals its content out of the row, but React still bubbles the menu-item
    // click up the React tree. Picking an action must run the action without selecting the row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onContextMenuAction).toHaveBeenCalledWith(ITEMS[0], EDIT_ACTION)
    expect(onSelect).not.toHaveBeenCalled()

    requestAnimationFrameSpy.mockRestore()
  })

  it('does not reserve a leading slot for entities without icons', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        items={[{ id: 'assistant-a', name: 'Assistant A' }]}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(
      screen
        .getByText('Assistant A')
        .closest('[role="option"]')
        ?.querySelector('[data-resource-list-leading-slot=true]')
    ).toBeNull()
  })

  it('splits pinned and non-pinned entities into two flush section headers while keeping avatars', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        items={[
          { id: 'assistant-b', name: 'Assistant B', icon: <span data-testid="assistant-b-icon" />, pinned: true },
          { id: 'assistant-a', name: 'Assistant A', icon: <span data-testid="assistant-a-icon" /> }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    // Pinned section (i18n key under the mocked translator) + the non-pinned "助手"/"智能体" section.
    expect(screen.getByText('selector.common.pinned_title')).toBeInTheDocument()
    expect(screen.getByText('Assistants')).toBeInTheDocument()

    // Both rows keep their avatar in a visible leading slot (not collapsed away by the section).
    const pinnedRow = screen.getByText('Assistant B').closest('[role="option"]')
    expect(pinnedRow?.querySelector('[data-resource-list-leading-slot="true"]')).not.toBeNull()
    expect(screen.getByTestId('assistant-b-icon')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-a-icon')).toBeInTheDocument()
  })

  it('groups non-pinned entities into per-tag sections while keeping pinned on top', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        groupByTag
        items={[
          { id: 'pinned-tagged', name: 'Pinned Tagged', icon: <span />, pinned: true, tag: 'work' },
          { id: 'work-a', name: 'Work A', icon: <span data-testid="work-a-icon" />, tag: 'work' },
          { id: 'home-a', name: 'Home A', icon: <span />, tag: 'home' },
          { id: 'loose', name: 'Loose', icon: <span />, tag: undefined }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    // Pinned section stays on top; non-pinned entities split into tag sections + an untagged section.
    expect(screen.getByText('selector.common.pinned_title')).toBeInTheDocument()
    expect(screen.getByText('work')).toBeInTheDocument()
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.getByText('assistants.tags.untagged')).toBeInTheDocument()
    expect(
      Array.from(
        screen.getByRole('listbox', { name: 'Assistants list' }).querySelectorAll('button[aria-expanded]')
      ).map((header) => header.textContent)
    ).toEqual(['selector.common.pinned_title', 'assistants.tags.untagged', 'work', 'home'])
    // A pinned entity stays under the pinned section even though it carries a tag — its tag must not
    // spawn a second "work" header.
    expect(screen.getAllByText('work')).toHaveLength(1)
    // The flat default "Assistants" header never appears while grouping by tag.
    expect(screen.queryByText('Assistants')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-a-icon')).toBeInTheDocument()
    const listbox = screen.getByRole('listbox', { name: 'Assistants list' })
    expect(listbox).toHaveAttribute('data-draggable', 'true')
    expect(JSON.parse(listbox.getAttribute('data-drag-capabilities') ?? '{}')).toMatchObject({
      groups: false,
      items: true,
      itemSameGroup: true,
      itemCrossGroup: false
    })
  })

  it('renders tag section headers with the shared hover and collapse affordance', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        groupByTag
        items={[
          { id: 'work-a', name: 'Work A', icon: <span />, tag: 'work' },
          { id: 'home-a', name: 'Home A', icon: <span />, tag: 'home' }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    const workHeader = screen.getByRole('button', { name: 'work' })
    const visualRow = workHeader.closest('div')

    expect(visualRow).toHaveClass('hover:bg-sidebar-accent', 'rounded-lg')
    expect(workHeader.querySelector('svg')).not.toBeNull()

    fireEvent.click(workHeader)
    expect(workHeader).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a real tag named like the untagged sentinel separate from untagged entities', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        groupByTag
        items={[
          { id: 'sentinel-tagged', name: 'Sentinel Tagged', icon: <span />, tag: '__untagged__' },
          { id: 'loose', name: 'Loose', icon: <span />, tag: undefined }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('__untagged__')).toBeInTheDocument()
    expect(screen.getByText('assistants.tags.untagged')).toBeInTheDocument()
  })

  it('ignores entity tags when groupByTag is off', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        items={[
          { id: 'work-a', name: 'Work A', icon: <span />, tag: 'work' },
          { id: 'home-a', name: 'Home A', icon: <span />, tag: 'home' }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByText('work')).not.toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
    expect(screen.queryByText('assistants.tags.untagged')).not.toBeInTheDocument()
  })

  it('renders a flat list with no section header when nothing is pinned', () => {
    render(
      <ResourceEntityRail
        addLabel="New"
        ariaLabel="Assistants list"
        defaultGroupLabel="Assistants"
        items={[
          { id: 'assistant-a', name: 'Assistant A', icon: <span data-testid="assistant-a-icon" /> },
          { id: 'assistant-b', name: 'Assistant B', icon: <span data-testid="assistant-b-icon" /> }
        ]}
        variant="assistant"
        onAdd={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    // Single section → no header shown (mirrors the modern layout), avatars still visible.
    expect(screen.queryByText('selector.common.pinned_title')).not.toBeInTheDocument()
    expect(screen.queryByText('Assistants')).not.toBeInTheDocument()
    expect(screen.getByTestId('assistant-a-icon')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-b-icon')).toBeInTheDocument()
  })
})
