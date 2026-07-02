import { MenuItem } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import { assertNever } from '@shared/utils/assertNever'
import type { ReactNode } from 'react'

import { ActiveIndicator, SidebarTabIcon } from './primitives'
import type { SidebarClickGuard } from './SidebarSortableList'
import { SidebarSortableList } from './SidebarSortableList'
import { SidebarTooltip } from './Tooltip'
import type { SidebarEntry, SidebarVisibleLayout } from './types'

export interface SidebarListProps {
  layout: SidebarVisibleLayout
  entries: SidebarEntry[]
  /** Active built-in app id. */
  activeItem: string
  /** Active mini app id (concrete mini app route). */
  activeTabId?: string
  onItemClick: (id: string) => void | Promise<void>
  onMiniAppTabClick?: (tabId: string) => void
  onReorder?: (event: { oldIndex: number; newIndex: number }) => void
  onContextMenuOpenChange?: (open: boolean) => void
}

/**
 * Renders built-in apps and mini apps as one continuous, drag-reorderable list.
 * A single `SidebarSortableList` (one dnd-kit context) backs the whole list, so a
 * drag can move an item to any position regardless of type — apps and mini apps
 * freely interleave with no divider between them.
 */
export function SidebarList({ layout, ...props }: SidebarListProps) {
  if (layout === 'icon') return <IconList {...props} />
  return <FullList {...props} />
}

type ListProps = Omit<SidebarListProps, 'layout'>

function EntryContextMenu({
  children,
  items,
  onOpenChange
}: {
  children: ReactNode
  items?: SidebarEntry['contextMenuItems']
  onOpenChange?: (open: boolean) => void
}) {
  if (!items?.length) return <>{children}</>

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items} onOpenChange={onOpenChange}>
      {children}
    </CommandContextMenu>
  )
}

function getEntryLabel(entry: SidebarEntry): string {
  switch (entry.kind) {
    case 'app':
      return entry.label
    case 'miniapp':
      return entry.title
    default:
      return assertNever(entry)
  }
}

function isEntryActive(entry: SidebarEntry, activeItem: string, activeTabId?: string): boolean {
  switch (entry.kind) {
    case 'app':
      return activeItem === entry.id
    case 'miniapp':
      return activeTabId === entry.id
    default:
      return assertNever(entry)
  }
}

function handleEntryClick(
  entry: SidebarEntry,
  onItemClick: ListProps['onItemClick'],
  onMiniAppTabClick?: (id: string) => void
) {
  switch (entry.kind) {
    case 'app':
      void onItemClick(entry.id)
      return
    case 'miniapp':
      onMiniAppTabClick?.(entry.id)
      return
    default:
      assertNever(entry)
  }
}

function EntryIcon({ entry, size, miniAppSize }: { entry: SidebarEntry; size: number; miniAppSize: 'md' | 'lg' }) {
  switch (entry.kind) {
    case 'app': {
      const Icon = entry.icon
      return <Icon size={size} strokeWidth={1.6} />
    }
    case 'miniapp':
      return <SidebarTabIcon tab={entry} size={size} strokeWidth={1.6} miniAppSize={miniAppSize} />
    default:
      return assertNever(entry)
  }
}

function IconList({
  entries,
  activeItem,
  activeTabId,
  onItemClick,
  onMiniAppTabClick,
  onReorder,
  onContextMenuOpenChange
}: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="id"
      onReorder={onReorder}
      className="flex flex-col items-center gap-0.5 px-1.5 [-webkit-app-region:no-drag]">
      {(entry, guardClick) => {
        const isActive = isEntryActive(entry, activeItem, activeTabId)
        const label = getEntryLabel(entry)

        return (
          <SidebarTooltip key={entry.id} content={label}>
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <button
                type="button"
                aria-label={label}
                onClick={guardClick(() => handleEntryClick(entry, onItemClick, onMiniAppTabClick))}
                className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
                  isActive
                    ? 'bg-sidebar-active-bg text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}>
                {isActive && <ActiveIndicator className="rounded-full" />}
                <EntryIcon entry={entry} size={18} miniAppSize="lg" />
              </button>
            </EntryContextMenu>
          </SidebarTooltip>
        )
      }}
    </SidebarSortableList>
  )
}

function FullList({
  entries,
  activeItem,
  activeTabId,
  onItemClick,
  onMiniAppTabClick,
  onReorder,
  onContextMenuOpenChange
}: ListProps) {
  return (
    <SidebarSortableList
      items={entries}
      itemKey="id"
      onReorder={onReorder}
      className="space-y-0.5 px-2 [-webkit-app-region:no-drag]">
      {(entry, guardClick: SidebarClickGuard) => {
        const isActive = isEntryActive(entry, activeItem, activeTabId)
        const label = getEntryLabel(entry)

        return (
          <div key={entry.id} className="relative">
            <EntryContextMenu items={entry.contextMenuItems} onOpenChange={onContextMenuOpenChange}>
              <MenuItem
                variant="ghost"
                icon={<EntryIcon entry={entry} size={16} miniAppSize="md" />}
                label={label}
                active={isActive}
                onClick={guardClick(() => handleEntryClick(entry, onItemClick, onMiniAppTabClick))}
                className="rounded-xl data-[active=true]:bg-sidebar-active-bg"
              />
            </EntryContextMenu>
            {isActive && <ActiveIndicator className="rounded-xl" />}
          </div>
        )
      }}
    </SidebarSortableList>
  )
}
