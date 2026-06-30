import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { ResourceEntityRail, type ResourceEntityRailItem } from '../ResourceEntityRail'

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

  const GroupedVirtualList = ({
    ref,
    className,
    groups,
    renderGroupFooter,
    renderGroupHeader,
    renderItem,
    role,
    scrollerProps,
    scrollElementRef
  }) => {
    const rows = buildGroupedVirtualRows(groups, Boolean(renderGroupHeader), Boolean(renderGroupFooter))

    return (
      <div
        ref={(node) => {
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
    GroupedSortableVirtualList: GroupedVirtualList,
    GroupedVirtualList
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

  it('uses grouped-list entity typography and selected state', () => {
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
        selectedId="assistant-a"
        variant="assistant"
        onAdd={vi.fn()}
        onContextMenuAction={onContextMenuAction}
        onSelect={onSelect}
      />
    )

    const selectedTitle = screen.getByText('Assistant A')
    const selectedRow = selectedTitle.closest('[role="option"]')
    const selectedLeadingSlot = screen
      .getByTestId('assistant-a-icon')
      .closest('[data-resource-list-leading-slot="true"]')

    expect(selectedRow).toHaveAttribute('data-selected', 'true')
    expect(selectedRow).toHaveClass('bg-sidebar-accent', 'text-sidebar-foreground', 'shadow-none')
    expect(selectedTitle).toHaveClass(
      'font-medium',
      'text-foreground',
      'transition-[padding]',
      'group-hover:pr-7',
      'group-focus-within:pr-7',
      'group-hover:text-inherit',
      'group-focus-visible:text-inherit',
      'group-data-[selected=true]:text-inherit'
    )
    expect(selectedTitle).not.toHaveClass('font-normal', 'text-sidebar-foreground/70')
    expect(selectedLeadingSlot).toHaveClass(
      'text-foreground',
      'group-hover:text-inherit',
      'group-focus-visible:text-inherit',
      'group-data-[selected=true]:text-inherit'
    )

    expect(screen.getAllByRole('button', { name: 'common.more' })[0]).toHaveClass('size-6', '[&_svg]:size-3!')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onContextMenuAction).toHaveBeenCalledWith(ITEMS[0], EDIT_ACTION)

    requestAnimationFrameSpy.mockRestore()
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

    // Single section → no header shown (mirrors the efficiency view), avatars still visible.
    expect(screen.queryByText('selector.common.pinned_title')).not.toBeInTheDocument()
    expect(screen.queryByText('Assistants')).not.toBeInTheDocument()
    expect(screen.getByTestId('assistant-a-icon')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-b-icon')).toBeInTheDocument()
  })
})
